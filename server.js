const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { categories } = require("./quiz-data");

const app = express();
const PORT = process.env.PORT || 4000;

// Health check endpoint for Render
app.get("/", (req, res) => {
  res.send("Brain Buzz WebSocket server is running 🚀");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Rooms state: Map<roomId, RoomState>
const rooms = new Map();
const DEFAULT_TIMEOUT = 10;

// Helper: generate random room ID
function generateRoomId(length = 10) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Get existing or create new room state
function getOrCreateRoom(roomId, category) {
  const categoryFound = categories.find(
    (categoryEntry) => categoryEntry.categoryName === category
  );
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: new Map(),
      quizCategory: categoryFound || categories[0],
      currentQuestionIndex: 0,
      questionTimer: DEFAULT_TIMEOUT,
      interval: null,
      quizStarted: false,
    });
  }
  return rooms.get(roomId);
}

// Broadcast message to all clients in a room
function broadcastToRoom(roomId, data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
      client.send(JSON.stringify(data));
    }
  });
}

function getQuizState(room) {
  const question = room.quizCategory.questions[room.currentQuestionIndex];
  return {
    question: {
      text: question.questionText,
      options: question.options,
      correctAnswerIndex: question.correctAnswerIndex,
    },
    timer: room.questionTimer,
    leaderboard: Array.from(room.players.values()),
  };
}

function startTimerForRoom(roomId) {
  const room = getOrCreateRoom(roomId);

  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }

  room.interval = setInterval(() => {
    room.questionTimer--;

    if (room.questionTimer < 0) {
      clearInterval(room.interval);
      room.interval = null;
      room.currentQuestionIndex++;

      if (room.currentQuestionIndex >= room.quizCategory.questions.length) {
        broadcastToRoom(roomId, {
          type: "quizOver",
          state: { leaderboard: Array.from(room.players.values()) },
        });
        resetQuizForRoom(roomId);
        return;
      }

      setTimeout(() => {
        room.questionTimer = DEFAULT_TIMEOUT;
        broadcastToRoom(roomId, {
          type: "quizStateUpdate",
          state: getQuizState(room),
        });
        room.interval = startTimerForRoom(roomId);
      }, 3000);
    } else {
      broadcastToRoom(roomId, {
        type: "timerUpdate",
        state: { timer: room.questionTimer },
      });
    }
  }, 1000);

  return room.interval;
}

function resetQuizForRoom(roomId) {
  console.log("reset-called!");
  const room = getOrCreateRoom(roomId);
  clearInterval(room.interval);
  room.interval = null;
  room.currentQuestionIndex = 0;
  room.questionTimer = DEFAULT_TIMEOUT;
  room.quizStarted = false;

  room.players.forEach((player) => {
    player.score = 0;
    player.correctAnswers = 0;
    player.connected = true;
    player.completed = false;
  });

  broadcastToRoom(roomId, { type: "quizReset" });
  console.log(`Quiz reset for room: ${roomId}`);
}

wss.on("connection", (ws) => {
  const id = ws._socket.remoteAddress + ":" + ws._socket.remotePort;
  console.log(`Client connected: ${id}`);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log("Received data:", data);

      switch (data.type) {
        case "joinQuiz": {
          const { name, roomId, category } = data.data;
          ws.roomId = roomId || generateRoomId();

          const room = getOrCreateRoom(ws.roomId, category);
          const categoryFound = categories.find(
            (categoryEntry) => categoryEntry.categoryName === category
          );

          room.players.set(id, {
            id,
            name,
            score: 0,
            correctAnswers: 0,
            connected: true,
            completed: false,
            totalQuestions: categoryFound.questions.length || 0,
          });

          if (!roomId) {
            ws.send(
              JSON.stringify({
                type: "roomIdAssigned",
                roomId: ws.roomId,
              })
            );
          }

          broadcastToRoom(ws.roomId, {
            type: "leaderboardUpdate",
            state: { leaderboard: Array.from(room.players.values()) },
          });
          break;
        }

        case "startQuiz": {
          const room = getOrCreateRoom(ws.roomId);
          if (!room) return;

          if (room.quizStarted) {
            ws.send(
              JSON.stringify({
                type: "quizStart",
                state: getQuizState(room),
              })
            );
            break;
          }

          room.quizStarted = true;
          room.currentQuestionIndex = 0;
          room.questionTimer = DEFAULT_TIMEOUT;

          broadcastToRoom(ws.roomId, {
            type: "quizStart",
            state: getQuizState(room),
          });

          startTimerForRoom(ws.roomId);
          break;
        }

        case "submitAnswer": {
          const room = getOrCreateRoom(ws.roomId);
          if (!room) return;

          const player = room.players.get(id);
          if (!player) return;

          const currentQ =
            room.quizCategory.questions[room.currentQuestionIndex];
          const correct = data.data.answer === currentQ.correctAnswerIndex;

          if (correct) {
            const points = data.data.time * 10;
            player.score += points;
            player.correctAnswers++;
          }

          broadcastToRoom(ws.roomId, {
            type: "leaderboardUpdate",
            state: { leaderboard: Array.from(room.players.values()) },
          });
          break;
        }

        case "quizReset": {
          const room = getOrCreateRoom(ws.roomId);
          if (!room) return;

          const player = room.players.get(id);
          if (player) {
            player.connected = false;
            console.log(`Player ${player.name} reset/disconnected.`);

            broadcastToRoom(ws.roomId, {
              type: "leaderboardUpdate",
              state: { leaderboard: Array.from(room.players.values()) },
            });

            if ([...room.players.values()].every((p) => !p.connected)) {
              console.log("All players disconnected. Resetting game.");
              resetQuizForRoom(ws.roomId);
            }
          }
          break;
        }

        default:
          console.log("Unknown message type:", data.type);
      }
    } catch (err) {
      console.error("Error parsing message:", err);
    }
  });

  ws.on("close", () => {
    const room = getOrCreateRoom(ws.roomId);
    if (room) {
      room.players.delete(id);

      broadcastToRoom(ws.roomId, {
        type: "leaderboardUpdate",
        state: { leaderboard: Array.from(room.players.values()) },
      });

      if ([...room.players.values()].every((p) => !p.connected)) {
        resetQuizForRoom(ws.roomId);
      }
    }
    console.log(`Client disconnected: ${id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
