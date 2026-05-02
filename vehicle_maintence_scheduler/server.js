require("dotenv").config();
var express = require("express");
var axios = require("axios");
var config = require("./config");
var knapsack = require("./knapsack");
var logger = require("logging-middleware");

var app = express();
app.use(express.json());

var authToken = null;
var depotsCache = [];
var vehiclesCache = [];

var httpClient = axios.create({
  baseURL: config.baseUrl.replace(/\/+$/, ""),
  timeout: 15000
});

var TYPE_WEIGHT = { Placement: 3, Result: 2, Event: 1 };
var TOP_N = 10;

async function authenticate() {
  if (authToken) return authToken;
  var res = await httpClient.post("/evaluation-service/auth", {
    email: config.email,
    name: config.name,
    rollNo: config.rollNo,
    accessCode: config.accessCode,
    clientID: config.clientID,
    clientSecret: config.clientSecret
  });
  authToken = res.data.access_token;
  logger.init(authToken);
  logger.Log("backend", "info", "auth", "Token acquired");
  return authToken;
}

async function ensureAuth() {
  if (!authToken) await authenticate();
  return authToken;
}

function priorityScore(n) {
  var weight = TYPE_WEIGHT[n.Type] || 0;
  var ts = new Date(n.Timestamp).getTime();
  return weight * 1000000000000 + ts;
}

function MinHeap() { this.heap = []; }

MinHeap.prototype.parentIdx = function (i) { return Math.floor((i - 1) / 2); };
MinHeap.prototype.leftIdx   = function (i) { return 2 * i + 1; };
MinHeap.prototype.rightIdx  = function (i) { return 2 * i + 2; };

MinHeap.prototype.swap = function (i, j) {
  var tmp = this.heap[i]; this.heap[i] = this.heap[j]; this.heap[j] = tmp;
};

MinHeap.prototype.bubbleUp = function (i) {
  while (i > 0) {
    var p = this.parentIdx(i);
    if (this.heap[p].score <= this.heap[i].score) break;
    this.swap(i, p);
    i = p;
  }
};

MinHeap.prototype.siftDown = function (i) {
  var n = this.heap.length;
  while (true) {
    var s = i;
    var l = this.leftIdx(i);
    var r = this.rightIdx(i);
    if (l < n && this.heap[l].score < this.heap[s].score) s = l;
    if (r < n && this.heap[r].score < this.heap[s].score) s = r;
    if (s === i) break;
    this.swap(i, s);
    i = s;
  }
};

MinHeap.prototype.insert = function (notification) {
  var score = priorityScore(notification);
  if (this.heap.length < TOP_N) {
    this.heap.push({ score: score, notification: notification });
    this.bubbleUp(this.heap.length - 1);
    return;
  }
  if (score > this.heap[0].score) {
    this.heap[0] = { score: score, notification: notification };
    this.siftDown(0);
  }
};

MinHeap.prototype.getTop = function () {
  return this.heap
    .slice()
    .sort(function (a, b) { return b.score - a.score; })
    .map(function (e) { return e.notification; });
};

async function fetchNotifications() {
  var token = await ensureAuth();
  var res = await httpClient.get("/evaluation-service/notifications", {
    headers: { Authorization: "Bearer " + token }
  });
  logger.Log("backend", "info", "service", "Notifications fetched: " + res.data.notifications.length);
  return res.data.notifications;
}

async function fetchDepots() {
  var token = await ensureAuth();
  var res = await httpClient.get("/evaluation-service/depots", {
    headers: { Authorization: "Bearer " + token }
  });
  depotsCache = res.data.depots;
  logger.Log("backend", "info", "service", "Depots loaded: " + depotsCache.length);
  return depotsCache;
}

async function fetchVehicles() {
  var token = await ensureAuth();
  var res = await httpClient.get("/evaluation-service/vehicles", {
    headers: { Authorization: "Bearer " + token }
  });
  vehiclesCache = res.data.vehicles;
  logger.Log("backend", "info", "service", "Vehicles loaded: " + vehiclesCache.length);
  return vehiclesCache;
}

app.get("/", function (req, res) {
  res.json({
    service: "Integrated Evaluation Service",
    status: "running",
    endpoints: [
      "GET /evaluation-service/notifications",
      "GET /evaluation-service/notifications/priority-inbox",
      "GET /evaluation-service/depots",
      "GET /evaluation-service/vehicles",
      "GET /evaluation-service/schedule"
    ]
  });
});

app.get("/evaluation-service/notifications", async function (req, res) {
  try {
    logger.Log("backend", "info", "handler", "GET /evaluation-service/notifications");
    var notifications = await fetchNotifications();
    res.json({ notifications: notifications });
  } catch (err) {
    logger.Log("backend", "error", "handler", "Failed: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/evaluation-service/notifications/priority-inbox", async function (req, res) {
  try {
    logger.Log("backend", "info", "handler", "GET /evaluation-service/notifications/priority-inbox");
    var notifications = await fetchNotifications();
    var inbox = new MinHeap();
    for (var i = 0; i < notifications.length; i++) {
      inbox.insert(notifications[i]);
    }
    var top10 = inbox.getTop();
    logger.Log("backend", "info", "handler", "Top " + top10.length + " resolved");
    res.json({ top10: top10 });
  } catch (err) {
    logger.Log("backend", "error", "handler", "Failed: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/evaluation-service/depots", async function (req, res) {
  try {
    logger.Log("backend", "info", "handler", "GET /evaluation-service/depots");
    if (depotsCache.length === 0) await fetchDepots();
    res.json({ depots: depotsCache });
  } catch (err) {
    logger.Log("backend", "error", "handler", "Failed: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/evaluation-service/vehicles", async function (req, res) {
  try {
    logger.Log("backend", "info", "handler", "GET /evaluation-service/vehicles");
    if (vehiclesCache.length === 0) await fetchVehicles();
    res.json({ vehicles: vehiclesCache });
  } catch (err) {
    logger.Log("backend", "error", "handler", "Failed: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/evaluation-service/schedule", async function (req, res) {
  try {
    logger.Log("backend", "info", "handler", "GET /evaluation-service/schedule");
    if (depotsCache.length === 0) await fetchDepots();
    if (vehiclesCache.length === 0) await fetchVehicles();
    var results = [];
    for (var d = 0; d < depotsCache.length; d++) {
      var depot = depotsCache[d];
      var items = vehiclesCache.map(function (v) {
        return { TaskID: v.TaskID, Duration: v.Duration, Impact: v.Impact };
      });
      var solution = knapsack.solve(items, depot.MechanicHours);
      results.push({
        ID: depot.ID,
        MechanicHours: depot.MechanicHours,
        maxTotalImpact: solution.maxImpact,
        totalDurationUsed: solution.totalDuration,
        remainingHours: solution.remainingCapacity,
        tasksSelected: solution.selectedTasks.length,
        selectedTasks: solution.selectedTasks
      });
    }
    logger.Log("backend", "info", "handler", "Schedule computed for all depots");
    res.json({ schedules: results });
  } catch (err) {
    logger.Log("backend", "error", "handler", "Failed: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(config.port, function () {
  console.log("Server running at http://localhost:" + config.port);
  console.log("  http://localhost:" + config.port + "/evaluation-service/notifications");
  console.log("  http://localhost:" + config.port + "/evaluation-service/notifications/priority-inbox");
  console.log("  http://localhost:" + config.port + "/evaluation-service/depots");
  console.log("  http://localhost:" + config.port + "/evaluation-service/vehicles");
  console.log("  http://localhost:" + config.port + "/evaluation-service/schedule");
  authenticate()
    .then(function () { return Promise.all([fetchDepots(), fetchVehicles()]); })
    .then(function () { console.log("Ready."); })
    .catch(function (err) { console.log("Init error: " + err.message); });
});