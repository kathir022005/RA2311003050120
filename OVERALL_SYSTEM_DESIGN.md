# Overall System Design: Integrated Evaluation Service

## 1. System Overview
The Integrated Evaluation Service is a robust, scalable backend system built with Node.js and Express. It elegantly combines two distinct business domains into a unified architectural pattern while maintaining logical separation of concerns.

The two primary domains are:
1. **Vehicle Maintenance Scheduler**: A resource optimization engine.
2. **Campus Notifications**: A prioritized communication delivery system.

Both systems are backed by a centralized **Custom Logging Middleware** and authenticate securely against external evaluation servers.

---

## 2. High-Level Architecture

### Core Technologies
*   **Runtime**: Node.js v22+
*   **Framework**: Express.js (REST API Routing)
*   **HTTP Client**: Axios (External Service Communication)
*   **Configuration**: Environment Variables (`.env`)

### Architecture Pattern
The system follows a **Modular Monolith** pattern. While it acts as a single deployable unit running on a designated port, its internal modules (`knapsack.js`, notification handlers, etc.) are strictly decoupled. This allows for easy extraction into separate microservices if the application scales.

### Authentication & Caching
*   **Lazy Authentication**: The server starts instantly and authenticates in the background asynchronously. If a request comes in before auth completes, it dynamically waits and ensures authentication.
*   **In-Memory Caching**: To prevent hammering external evaluation APIs, `depots` and `vehicles` are cached in memory after the first fetch, drastically reducing network latency for subsequent scheduling requests.

---

## 3. Module 1: Vehicle Maintenance Scheduler

### Problem Domain
Optimize the scheduling of vehicle maintenance tasks across multiple depots, each with a strict limit on available mechanic hours, to maximize the total "impact" of the completed tasks.

### Algorithmic Approach: 0/1 Knapsack (Dynamic Programming)
The scheduling problem maps perfectly to the **0/1 Knapsack Problem**:
*   **Knapsack Capacity** = Depot's Mechanic Hours
*   **Item Weight** = Vehicle Task Duration
*   **Item Value** = Vehicle Task Impact

**Implementation Details (`knapsack.js`):**
*   **Time Complexity**: `O(N * W)` where `N` is the number of tasks and `W` is the mechanic hours.
*   **Space Complexity**: `O(N * W)` using a 2D DP array.
*   **Traceback Mechanism**: After filling the DP table to find the maximum impact, the algorithm traces back through the matrix to identify the exact `TaskID`s selected, ensuring the schedule is actionable.

---

## 4. Module 2: Campus Notifications (Priority Inbox)

### Problem Domain
Students receive thousands of notifications. The system must intelligently rank them so that critical updates (like Placements and Results) appear first, while still respecting chronological recency.

### Algorithmic Approach: Weighted Scoring & Min-Heap
To generate the "Priority Inbox" (Top 10 notifications), the system uses a combination of weighted scoring and an optimized data structure.

**1. Priority Scoring Formula:**
`Priority Score = (Type Weight * 10^12) + Timestamp (ms)`
*   Placement Weight: 3
*   Result Weight: 2
*   Event Weight: 1
*   *Why?* This ensures that a newer Event will never outrank an older Placement, but within the same category, newer notifications always win.

**2. Top N Selection (Min-Heap):**
Sorting millions of notifications just to find the top 10 is inefficient `O(N log N)`. 
Instead, the system implements a custom **Min-Heap**:
*   As notifications stream in, they are evaluated against the root of a Min-Heap capped at size `N` (10).
*   If a notification's score is higher than the minimum score currently in the Top 10, the minimum is popped, and the new notification is inserted (`O(log K)`).
*   **Time Complexity**: `O(N log K)` where `N` is total notifications and `K` is 10. This effectively reduces to `O(N)`, making it lightning-fast regardless of volume.

---

## 5. Custom Logging Middleware

To ensure compliance with the evaluation environment, the system utilizes a custom, isolated `logging_middleware` package.

*   **Design**: It acts as an interceptor. Instead of writing logs to `stdout` (like `console.log`), it structures the log data (Level, Package, Message) and asynchronously POSTs it directly to the `/evaluation-service/log` endpoint.
*   **Resilience**: The logger is initialized with the Bearer token upon startup and gracefully handles network timeouts without crashing the main application thread.

---

## 6. Endpoints Directory

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/evaluation-service/schedule` | Computes and returns optimized schedules for all depots. |
| `GET` | `/evaluation-service/notifications/priority-inbox` | Returns the Top 10 priority notifications using Min-Heap. |
| `GET` | `/evaluation-service/notifications` | Returns all raw notifications. |
| `GET` | `/evaluation-service/depots` | Fetches raw depot data. |
| `GET` | `/evaluation-service/vehicles` | Fetches raw vehicle data. |
