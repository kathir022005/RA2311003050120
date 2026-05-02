# RA2311003050120

Backend Evaluation Submission

## Structure

- `logging_middleware/` - Reusable logging package
- `vehicle_maintence_scheduler/` - Vehicle maintenance scheduling microservice
- `notification_system_design.md` - Notification system design document
- `notification_app_be/` - Notification priority inbox backend

## Setup

1. Install dependencies in each folder:
   ```
   cd logging_middleware && npm install
   cd vehicle_maintence_scheduler && npm install
   cd notification_app_be && npm install
   ```

2. Update credentials in `vehicle_maintence_scheduler/config.js` and `notification_app_be/config.js`

3. Run services:
   ```
   cd vehicle_maintence_scheduler && node index.js
   cd notification_app_be && node index.js
   ```
