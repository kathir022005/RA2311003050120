# Notification System Design

## Stage 1

### Core Actions

The notification platform needs to support these main operations:

1. Fetching notifications for a logged-in student
2. Marking a notification as read
3. Marking all notifications as read
4. Getting unread notification count
5. Receiving real-time notifications

### REST API Endpoints

#### GET /evaluation-service/notifications
Fetch all notifications for the current student with pagination.

**Request Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `page` (integer, default: 1)
- `limit` (integer, default: 20)
- `type` (string, optional) - filter by "Placement", "Result", or "Event"
- `isRead` (boolean, optional) - filter read/unread

**Response (200):**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "Placement",
      "message": "Company XYZ hiring",
      "timestamp": "2026-04-22 17:51:30",
      "isRead": false
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 85,
    "totalPages": 5
  }
}
```

#### GET /evaluation-service/notifications/unread-count
Returns the count of unread notifications.

**Response (200):**
```json
{
  "unreadCount": 12
}
```

#### PATCH /evaluation-service/notifications/:id/read
Mark a single notification as read.

**Response (200):**
```json
{
  "id": "uuid",
  "isRead": true,
  "message": "Notification marked as read"
}
```

#### PATCH /evaluation-service/notifications/read-all
Mark all notifications as read for the current student.

**Response (200):**
```json
{
  "updatedCount": 12,
  "message": "All notifications marked as read"
}
```

#### DELETE /evaluation-service/notifications/:id
Delete a single notification.

**Response (200):**
```json
{
  "message": "Notification deleted"
}
```

### Real-Time Notification Mechanism

I would use **Server-Sent Events (SSE)** for real-time delivery because:

- It works over standard HTTP so there is no need for a separate protocol like WebSocket
- It is unidirectional (server to client) which fits our use case perfectly since the server pushes notifications to students
- Automatic reconnection is built into the browser's EventSource API
- Simpler to implement and maintain than WebSockets for this use case

**Endpoint:** `GET /evaluation-service/notifications/stream`

The client connects using EventSource:
```javascript
var source = new EventSource("/evaluation-service/notifications/stream", {
  headers: { Authorization: "Bearer <token>" }
});

source.onmessage = function(event) {
  var notification = JSON.parse(event.data);
  // display notification in UI
};
```

The server keeps the connection open and pushes new notifications as they arrive. Each notification event contains the full notification object.

If the system needed bidirectional communication (e.g., students sending acknowledgments), WebSocket would be the better choice. But for a pure push-notification scenario, SSE is simpler and sufficient.

---

## Stage 2

### Database Choice: PostgreSQL

I recommend **PostgreSQL** for the following reasons:

1. The data is inherently relational (students have notifications, notifications have types)
2. Strong support for indexing which we will need for query performance at scale
3. ENUM types for notification categories
4. Good JSON support if we ever need flexible message payloads
5. ACID compliance ensures data consistency when marking notifications as read

### Schema

```sql
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id INTEGER NOT NULL REFERENCES students(id),
    notification_type notification_type NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notifications_student_unread
ON notifications(student_id, is_read, created_at DESC);

CREATE INDEX idx_notifications_type
ON notifications(notification_type);
```

### Potential Problems at Scale

1. **Table bloat**: With 50K students getting multiple notifications daily, the table grows fast. After a year we could have tens of millions of rows.
2. **Write contention**: Bulk notifications (sending to all 50K students at once) cause heavy write load.
3. **Read hot spots**: Every page load queries the notifications table, putting pressure on frequently accessed rows.
4. **Index maintenance overhead**: As the table grows, index updates on every INSERT slow down writes.

**Solutions:**
- Partition the notifications table by `created_at` (monthly partitions) so old data can be archived
- Use connection pooling (PgBouncer) to handle concurrent connections
- Archive notifications older than 6 months to a separate table or cold storage
- Consider read replicas for distributing read load

### Queries for REST APIs

**Fetch notifications with pagination:**
```sql
SELECT id, notification_type, message, is_read, created_at
FROM notifications
WHERE student_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;
```

**Get unread count:**
```sql
SELECT COUNT(*) as unread_count
FROM notifications
WHERE student_id = $1 AND is_read = false;
```

**Mark one as read:**
```sql
UPDATE notifications
SET is_read = true
WHERE id = $1 AND student_id = $2;
```

**Mark all as read:**
```sql
UPDATE notifications
SET is_read = true
WHERE student_id = $1 AND is_read = false;
```

---

## Stage 3

### Query Analysis

The given query:
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

**Is the query accurate?**
Yes, functionally it retrieves what is needed - all unread notifications for student 1042, sorted by newest first.

**Why is it slow?**
With 5 million notifications in the table, this query is slow because:
1. `SELECT *` fetches all columns, including potentially large text fields, when we may only need a subset
2. Without a composite index on `(studentID, isRead, createdAt)`, the database performs a full table scan filtering through all 5M rows
3. The ORDER BY requires sorting the matching rows which is expensive without an index that already has the data sorted
4. No LIMIT clause means it returns ALL unread notifications for that student, which could be thousands

**Likely computation cost:** O(N) where N is the total number of rows (5 million), since it has to scan each row to check the WHERE conditions.

**What I would change:**
```sql
SELECT id, notification_type, message, created_at
FROM notifications
WHERE student_id = 1042 AND is_read = false
ORDER BY created_at DESC
LIMIT 50;
```

And create this composite index:
```sql
CREATE INDEX idx_student_unread_recent
ON notifications(student_id, is_read, created_at DESC);
```

This way the query uses the index to directly jump to student 1042's unread notifications already sorted by date. The LIMIT prevents returning thousands of rows.

With the index, the query cost drops to O(log N + K) where K is the number of results returned.

### Adding indexes on every column?

This is bad advice. Here is why:

1. **Storage cost**: Each index consumes disk space. On a 5M row table, adding an index on every column could double or triple the storage
2. **Write performance**: Every INSERT, UPDATE, or DELETE now has to update ALL indexes. For a notification system that does frequent writes, this is devastating
3. **Diminishing returns**: An index on `message` (a text column) is rarely useful and very expensive to maintain
4. **The optimizer may ignore them**: PostgreSQL's query planner may not even use single-column indexes if multi-column composite indexes would be more efficient

The right approach is to create indexes based on actual query patterns. For this application, a composite index on `(student_id, is_read, created_at)` covers the most common query pattern.

### Placement notifications in last 7 days

```sql
SELECT DISTINCT student_id
FROM notifications
WHERE notification_type = 'Placement'
  AND created_at >= NOW() - INTERVAL '7 days';
```

---

## Stage 4

### Problem

Fetching notifications on every page load overwhelms the DB because each of the 50K students triggers a query every time they navigate within the app.

### Solutions

#### 1. Redis Caching Layer

Store each student's recent notifications in Redis with a TTL.

```
Key: notifications:{studentId}:recent
Value: JSON array of latest 50 notifications
TTL: 5 minutes
```

**Flow:**
1. On page load, check Redis first
2. If cache hit, return cached data
3. If cache miss, query DB, store result in Redis, return data
4. On new notification, invalidate the cache for that student

**Tradeoffs:**
- Pro: Drastically reduces DB load, sub-millisecond reads
- Con: Extra infrastructure (Redis), slight staleness (up to TTL window), memory cost for 50K student caches

#### 2. Pagination

Instead of loading all notifications, load only the first page (20 items). Load more only when the user scrolls.

**Tradeoffs:**
- Pro: Reduces data transferred per request significantly
- Con: Does not reduce the number of requests hitting the DB, just the data per request

#### 3. Cursor-Based Pagination

Use `created_at` timestamp as cursor instead of OFFSET-based pagination.

```sql
SELECT * FROM notifications
WHERE student_id = $1 AND created_at < $cursor
ORDER BY created_at DESC
LIMIT 20;
```

**Tradeoffs:**
- Pro: Consistent performance regardless of page number (OFFSET gets slower on later pages)
- Con: Cannot jump to arbitrary pages

#### 4. Unread Count Cache

Maintain a separate counter for unread notifications per student (in Redis or a separate table) instead of running COUNT(*) queries.

**Tradeoffs:**
- Pro: O(1) read for unread count
- Con: Counter must be kept in sync with the actual table state, adds complexity

### Recommended Combination

Use **Redis caching + cursor-based pagination + unread count cache** together. This reduces DB hits by over 90% while keeping the data fresh within an acceptable window.

---

## Stage 5

### Shortcomings of Current Implementation

```
function notify_all(student_ids, message):
    for student_id in student_ids:
        send_email(student_id, message)
        save_to_db(student_id, message)
        push_to_app(student_id, message)
```

1. **Single-threaded sequential processing**: Processing 50K students one by one is extremely slow
2. **No error handling**: When `send_email` fails for student 200, the entire loop may crash or silently skip subsequent operations for that student
3. **Coupled operations**: Email, DB save, and push notification are tightly coupled. If email fails, the DB save and push for that student are also skipped
4. **No retry mechanism**: Failed emails are lost forever
5. **No idempotency**: If the process crashes and restarts, it has no way to know which students were already processed
6. **DB and email should NOT happen together**: These are fundamentally different operations. DB save is fast and local. Email is slow and depends on an external service. Coupling them means a slow email API blocks everything

### When send_email fails for 200 students midway

The 200 students who failed got no email, likely no DB save, and no push notification either. But the loop already processed students before them. So we have a partial state where some students got everything and some got nothing.

### Redesigned Solution

```
function notify_all(student_ids, message):
    batch_id = generate_uuid()

    // Step 1: Save all notifications to DB in a batch
    save_batch_to_db(student_ids, message, batch_id)

    // Step 2: Push to message queue for async processing
    for student_id in student_ids:
        enqueue({
            batch_id: batch_id,
            student_id: student_id,
            message: message,
            email_status: "pending",
            push_status: "pending"
        })

// Queue worker processes each message independently
function process_queue_message(job):
    student_id = job.student_id
    message = job.message

    try:
        send_email(student_id, message)
        update_status(job.batch_id, student_id, "email", "sent")
    catch error:
        update_status(job.batch_id, student_id, "email", "failed")
        requeue_with_backoff(job, "email")

    try:
        push_to_app(student_id, message)
        update_status(job.batch_id, student_id, "push", "sent")
    catch error:
        update_status(job.batch_id, student_id, "push", "failed")
        requeue_with_backoff(job, "push")
```

### Key Design Decisions

1. **DB save happens first and in bulk**: This is the most reliable operation. Save all 50K records immediately so no data is lost regardless of what happens next.

2. **Email and push are decoupled via message queue**: Each student's email and push are processed independently. A failure for one student does not affect others.

3. **Retry with backoff**: Failed emails are requeued with exponential backoff (e.g., retry after 1s, 2s, 4s, 8s). After max retries, mark as permanently failed.

4. **Multiple queue workers**: Run several workers in parallel to process the queue. 50K emails with 10 workers is 5K per worker, much faster than sequential.

5. **DB save and email should NOT happen together**: Saving to DB is fast and reliable. Sending email depends on an external provider that can be slow or fail. If they are coupled, a slow email API blocks the DB save. Separating them means we can guarantee data persistence immediately and handle email delivery asynchronously.

---

## Stage 6

### Priority Inbox Approach

The priority score for each notification is calculated as a combination of two factors:

**Type Weight:**
- Placement = 3 (highest operational importance)
- Result = 2
- Event = 1 (lowest)

**Recency Score:**
- Normalized to a 0-1 range where 1 is the most recent notification and 0 is the oldest
- Formula: `(timestamp - minTimestamp) / (maxTimestamp - minTimestamp)`

**Combined Priority Score:**
```
priorityScore = typeWeight + recencyScore
```

This gives ranges of:
- Placement: 3.0 to 4.0
- Result: 2.0 to 3.0
- Event: 1.0 to 2.0

So Placement always ranks above Result, which always ranks above Event. Within the same type, more recent notifications rank higher.

### Maintaining Top 10 Efficiently

For a system where new notifications keep coming in, we use a **MinHeap** of size 10 (as implemented in the integrated service). When a new notification arrives:
1. Calculate its priority score: `weight * 1000000000000 + timestamp`.
2. If the heap has fewer than 10 items, insert it and bubble up.
3. If the new score is higher than the heap's minimum (the root at index 0), replace the root and sift down.
4. This gives O(log 10) = O(1) time complexity per insertion.

The implementation code is in the integrated `notification_app_be/index.js` file. You can test it by hitting the `GET /evaluation-service/notifications/priority-inbox` endpoint, which returns the top 10 results perfectly sorted.
