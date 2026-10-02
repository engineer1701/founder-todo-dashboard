const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { initDatabase } = require('./db/database');
const { runReminderScan } = require('./services/reminderEngine');

// Initialize SQLite database, schema, and seed data
initDatabase();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[API] ${req.method} ${req.path}`);
  }
  next();
});

// API Routes
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/emails', require('./routes/emails'));
app.use('/api/tests', require('./routes/tests'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    system: 'Founder To-Do Allocation & Follow-Up Engine',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Serve frontend in production if built
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDistPath));

// Fallback SPA routing for client
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.join(clientDistPath, 'index.html');
  if (require('node:fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not Found');
  }
});

// Start Background Reminder Engine Worker (Section 9)
// Periodic inspection interval: default every 60 seconds
const SCHEDULER_INTERVAL_MS = 60 * 1000;
let schedulerTimer = null;

function startBackgroundScheduler() {
  console.log(`[Scheduler] Initializing automated reminder engine worker (Interval: ${SCHEDULER_INTERVAL_MS / 1000}s)...`);
  // Run an initial scan on startup
  try {
    const startupScan = runReminderScan();
    console.log(`[Scheduler] Startup scan complete. Active tasks: ${startupScan.tasksScanned}, Reminders sent: ${startupScan.remindersSent}, Escalations: ${startupScan.escalationsSent}`);
  } catch (err) {
    console.error('[Scheduler] Error during initial scan:', err);
  }

  schedulerTimer = setInterval(() => {
    try {
      const scan = runReminderScan();
      if (scan.remindersSent > 0 || scan.escalationsSent > 0) {
        console.log(`[Scheduler] Background scan executed: ${scan.remindersSent} reminders, ${scan.escalationsSent} escalations dispatched.`);
      }
    } catch (err) {
      console.error('[Scheduler] Error during periodic scan:', err);
    }
  }, SCHEDULER_INTERVAL_MS);
}

// Start Server
app.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(` FOUNDER TO-DO ALLOCATION & FOLLOW-UP DASHBOARD SERVER `);
  console.log(` Server running on http://localhost:${PORT}             `);
  console.log(`========================================================`);
  startBackgroundScheduler();
});
