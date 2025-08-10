const players = new Map();

function addPlayer(id, name) {
  // If player exists, just mark connected, else add new
  if (!players.has(id)) {
    players.set(id, {
      name,
      score: 0,
      correctAnswers: 0,
      totalQuestions: 0,
      connected: true,
      completed: false,
    });
  } else {
    const player = players.get(id);
    player.connected = true;
  }
}

function removePlayer(id) {
  // Optionally just mark disconnected instead of full removal,
  // but here we do both for safety
  if (players.has(id)) {
    const player = players.get(id);
    player.connected = false;
    players.delete(id);
  }
}

function markPlayerConnected(id) {
  if (players.has(id)) {
    players.get(id).connected = true;
  }
}

function markPlayerDisconnected(id) {
  if (players.has(id)) {
    players.get(id).connected = false;
  }
}

function updatePlayerScore(id, points, correct) {
  const player = players.get(id);
  if (player) {
    player.score += points;
    if (correct) player.correctAnswers += 1;
  }
}

function markPlayerCompleted(id) {
  if (players.has(id)) {
    players.get(id).completed = true;
  }
}

function resetAllPlayers() {
  players.forEach((player) => {
    player.score = 0;
    player.correctAnswers = 0;
    player.completed = false;
    player.connected = false;
  });
}

function getLeaderboard() {
  return Array.from(players.entries())
    .filter(([_, player]) => player.connected)
    .map(([id, player]) => ({
      id,
      name: player.name,
      score: player.score,
      correctAnswers: player.correctAnswers,
      isCurrent: false, // optionally set this true for the current player in client code
      connected: player.connected,
    }))
    .sort((a, b) => b.score - a.score);
}

function getPlayer(id) {
  return players.get(id);
}

function allPlayersDisconnected() {
  if (players.size === 0) return true;
  return Array.from(players.values()).every((p) => !p.connected);
}

function allPlayersCompleted() {
  if (players.size === 0) return false;
  return Array.from(players.values()).every((p) => p.completed);
}

module.exports = {
  addPlayer,
  removePlayer,
  updatePlayerScore,
  getLeaderboard,
  getPlayer,
  markPlayerConnected,
  markPlayerDisconnected,
  markPlayerCompleted,
  resetAllPlayers,
  allPlayersDisconnected,
  allPlayersCompleted,
};
