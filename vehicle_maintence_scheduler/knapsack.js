function solve(items, capacity) {
  var n = items.length;
  var dp = [];

  for (var i = 0; i <= n; i++) {
    dp[i] = new Array(capacity + 1).fill(0);
  }

  for (var i = 1; i <= n; i++) {
    for (var w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (items[i - 1].duration <= w) {
        var val = dp[i - 1][w - items[i - 1].duration] + items[i - 1].impact;
        if (val > dp[i][w]) {
          dp[i][w] = val;
        }
      }
    }
  }

  var selected = [];
  var w = capacity;
  for (var i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(items[i - 1]);
      w -= items[i - 1].duration;
    }
  }

  var totalDur = 0;
  for (var j = 0; j < selected.length; j++) {
    totalDur += selected[j].duration;
  }

  return {
    maxImpact: dp[n][capacity],
    selectedTasks: selected,
    totalDuration: totalDur,
    remainingCapacity: capacity - totalDur
  };
}

module.exports = { solve };