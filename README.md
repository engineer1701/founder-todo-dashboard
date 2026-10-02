# Founder To-Do Allocation & Follow-Up Dashboard
> **Developer-Ready Product & Technical Implementation**  
> *Internal Task Management & Autonomous Reminder Automation for High-Growth Startups*

[![Acceptance Tests](https://img.shields.io/badge/Acceptance%20Tests-12%2F12%20PASSED-success?style=for-the-badge&logo=checkmarx)](docs/ACCEPTANCE_TEST_REPORT.md)
[![Node Version](https://img.shields.io/badge/Node.js-v22+-339933?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![SQLite Mode](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=for-the-badge&logo=sqlite)](server/db/database.js)
[![React](https://img.shields.io/badge/React-19%20SPA-61DAFB?style=for-the-badge&logo=react)](client)

---

## 🎯 Project Overview

In high-growth companies, tasks assigned by founders frequently stall due to follow-up friction, ambiguous ownership, and the burden of manual check-ins.

The **Founder To-Do Allocation & Follow-Up Dashboard** solves this problem by combining:
1. **Executive Task Delegation:** Founder-directed assignment with priorities, deadlines, instructions, and contributor roles.
2. **Inactivity Detection & Dynamic Reminder Engine:** Autonomous background monitoring that detects assignee inactivity and sends tiered reminders (`First Reminder` $\rightarrow$ `Second Notice` $\rightarrow$ `Founder Escalation`).
3. **Dual-Status Integrity (Section 4 Principle):** The system **never** overwrites the assignee's authentic work status with a generic `Overdue` string. Status flags (`is_overdue`, `is_inactive`, `hours_inactive`) are computed dynamically.
4. **Deep-Linked Email Delivery:** Every notification includes a authenticated, direct link (`/?task=<id>`) taking the employee directly into the task remark modal.
5. **Role-Based Access Control (RBAC):** Founders and Admins enjoy company-wide oversight; employees have access strictly isolated to their assigned tasks.
6. **Time-Travel Simulation Bar:** Fast-forward time (+12h, +24h, +48h, +72h) directly from the UI to test multi-day inactivity and escalation cascades without waiting real days.

---

## 🏛️ System Architecture

```
founder-todo-dashboard/
├── client/                     # React 19 + Vite Frontend SPA
│   ├── src/
│   │   ├── components/         # Dashboard, Employee, Settings, Mailbox, AT Views
│   │   ├── App.jsx             # Main Application Container & Deep-linking
│   │   └── index.css           # Premium Glassmorphism Design System
│   └── dist/                   # Production-ready built assets
├── server/                     # Express.js REST API Backend
│   ├── db/                     # SQLite Database, Schema, and Seed Data
│   ├── routes/                 # Tasks, Dashboard, Settings, Auth, Tests APIs
│   ├── services/               # Reminder Engine, Audit Service, Email Service
│   ├── tests/                  # CLI Acceptance Test Runner (AT-01 to AT-12)
│   └── server.js               # Unified Server (Port 5000) & Background Scheduler
└── docs/                       # Technical Specifications & Documentation
    ├── PRODUCT_SPECIFICATION.md# 15-Section Developer-Ready Product Spec
    ├── ARCHITECTURE.md         # System Architecture, Sequences & ER Model
    └── ACCEPTANCE_TEST_REPORT.md# Acceptance Test (AT-01 - AT-12) Verification
```

---

## 🚀 Quick Start Guide

### Prerequisites
- [Node.js](https://nodejs.org/) v20 or v22+
- NPM v10+

### Installation & Build
```bash
# 1. Install root backend dependencies
npm install

# 2. Build the optimized production client bundle
npm run build:client
```

### Running the Application
```bash
# Start unified server on http://localhost:5000
npm run server
```

The application is immediately accessible at:
👉 **`http://localhost:5000`**

*(Note: For live frontend HMR during UI development, you can run `npm run client` concurrently on port 5173).*

---

## 🧪 Acceptance Test Suite (AT-01 to AT-12)

The system includes a verified, 12-point acceptance test suite verifying all core user stories:

```bash
# Run acceptance test suite in terminal
npm run test:at
```

### Test Coverage Summary:
- **AT-01:** Founder creates a task and assigns it to an employee.
- **AT-02:** Employee changes status and adds a remark.
- **AT-03:** No update reaches first reminder threshold (24h).
- **AT-04:** Scheduler runs repeatedly after reminder already sent (Idempotency check).
- **AT-05:** Employee updates task after reminder $\rightarrow$ Inactivity timer resets.
- **AT-06:** Task reaches deadline incomplete $\rightarrow$ Overdue flag calculation.
- **AT-07:** Task is completed $\rightarrow$ Inactivity reminders stop.
- **AT-08:** Inactivity reaches escalation threshold (72h) $\rightarrow$ Founder receives escalation.
- **AT-09:** Employee requests another employee's task $\rightarrow$ Access denied (RBAC).
- **AT-10:** Founder filters overdue / high-priority / no-update tasks.
- **AT-11:** Email contains task link opening the authorized task detail modal.
- **AT-12:** Reminder settings are changed dynamically without code changes.

You can also run and inspect these tests directly in the web browser by navigating to the **"Acceptance Tests"** tab in the UI.

---

## 👥 Seed Personas for Testing

The database comes pre-seeded with realistic team members for testing:

| User Name | Role | Email | Department |
| :--- | :--- | :--- | :--- |
| **Vikram Singhania** | `founder` | `vikram@company.internal` | Executive Office |
| **Ananya Roy** | `admin` | `ananya.roy@company.internal` | Executive Office (Chief of Staff) |
| **Rahul Sharma** | `employee` | `rahul.sharma@company.internal` | Human Resources & Talent |
| **Priya Patel** | `employee` | `priya.patel@company.internal` | Engineering & Architecture |
| **Amit Verma** | `employee` | `amit.verma@company.internal` | Growth & Marketing |
| **Neha Gupta** | `employee` | `neha.gupta@company.internal` | Customer Operations |

*Tip: Use the User Switcher in the top-right header to seamlessly switch personas and test RBAC permissions.*

---

## 📚 Complete Technical Documentation

For the full developer specification and architectural designs, review:
- 📖 [Product & Technical Specification](docs/PRODUCT_SPECIFICATION.md)
- 📐 [Technical Architecture & Data Model](docs/ARCHITECTURE.md)
- 📊 [Acceptance Test Execution Report](docs/ACCEPTANCE_TEST_REPORT.md)
