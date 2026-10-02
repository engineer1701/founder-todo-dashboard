# Founder To-Do Allocation & Follow-Up Dashboard
## Technical Architecture & Implementation Deep-Dive
**Document Version:** 1.0.0  
**Effective Date:** 29 September 2026  

---

## 1. High-Level Architecture Overview

The platform uses a decoupled three-tier architecture comprising a modern React SPA, an Express REST API with native SQLite data access, and an in-process deterministic background worker.

```mermaid
graph TB
    subgraph ClientLayer ["Client Layer (Port 5173 / Port 5000 Dist)"]
        UI["React 19 SPA"]
        DashView["Founder Dashboard View"]
        EmpView["Employee Workspace"]
        MailboxView["Virtual Mailbox & Email Simulator"]
        SettingsView["Reminder Policy Tuning & Time Travel"]
        ATView["Live Acceptance Test Runner"]
    end

    subgraph APILayer ["Backend Service Layer (Express.js Port 5000)"]
        Router["Express HTTP Dispatcher"]
        AuthRoute["RBAC Middleware & User Switcher"]
        TaskRoute["Task CRUD & Status Transition Handler"]
        SettingsRoute["Reminder Policy Manager"]
        AuditService["Audit Log Recorder"]
        EmailService["Transactional Email Generator"]
    end

    subgraph DataLayer ["Data & Persistence Layer"]
        DB[("SQLite 3 Database (tasks.db)")]
        WAL["Write-Ahead Log (WAL Mode)"]
        FK["Foreign Key Constraint Engine"]
    end

    subgraph EngineLayer ["Asynchronous Automation"]
        Scheduler["Reminder Engine Worker (60s Interval)"]
        Dedupe["Cycle ID Deduplication Filter"]
        TimeTravel["Simulated Clock Engine"]
    end

    UI --> DashView
    UI --> EmpView
    UI --> MailboxView
    UI --> SettingsView
    UI --> ATView

    DashView -->|HTTP GET/POST /api/tasks| Router
    EmpView -->|HTTP POST /api/tasks/:id/status| Router
    SettingsView -->|HTTP PUT /api/settings/reminders| Router
    ATView -->|HTTP GET /api/tests/run| Router

    Router --> AuthRoute
    AuthRoute --> TaskRoute
    AuthRoute --> SettingsRoute

    TaskRoute --> DB
    TaskRoute --> AuditService
    TaskRoute --> EmailService

    AuditService --> DB
    EmailService --> DB

    Scheduler --> TimeTravel
    Scheduler --> Dedupe
    Dedupe --> DB
    Dedupe --> EmailService
```

---

## 2. Inactivity Detection & Escalation Sequence

The following sequence details how the background reminder engine evaluates a task, detects assignee inactivity, avoids duplicate emails, and escalates to the founder:

```mermaid
sequenceDiagram
    autonumber
    participant Scheduler as Background Scheduler (60s)
    participant Engine as Reminder Engine
    participant DB as SQLite Database
    participant Mailer as Email Service
    participant Founder as Founder Vikram
    participant Employee as Assignee Rahul

    Scheduler->>Engine: Trigger periodic scan
    Engine->>DB: Query active tasks & policy thresholds
    DB-->>Engine: Return tasks with last_progress_updated_at

    loop For Each Active Task
        Engine->>Engine: Calculate hours_inactive = (EffectiveNow - last_progress_updated_at)
        alt Inactivity >= 24h & < 48h (First Reminder)
            Engine->>Engine: Generate cycle_id: INACT_1_<id>_<last_updated>
            Engine->>DB: Check if cycle_id already recorded
            alt Not yet sent in this cycle
                Engine->>Mailer: Dispatch First Reminder email with deep-link
                Mailer->>Employee: Deliver follow-up notification
                Engine->>DB: Insert record into task_reminders & audit_logs
            else Already sent in this cycle
                Engine->>Engine: Increment skippedDuplicates counter (Idempotent)
            end
        else Inactivity >= 72h (Founder Escalation)
            Engine->>Engine: Generate cycle_id: ESCALATE_<id>_<last_updated>
            Engine->>DB: Check if cycle_id exists
            alt Not yet escalated
                Engine->>Mailer: Dispatch Escalation Alert to Founder & Admin
                Mailer->>Founder: Send urgent escalation email
                Engine->>DB: Record ESCALATION reminder and TASK_ESCALATED audit log
            end
        end
    end

    Employee->>DB: Clicks deep link & submits progress update (status='In Progress', 40%)
    Note over Employee,DB: last_progress_updated_at updated to CURRENT_TIMESTAMP
    Note over Engine,DB: Inactivity timer resets to 0; previous cycles invalidated
```

---

## 3. Database Entity-Relationship Specification

```mermaid
erDiagram
    departments {
        INTEGER id PK
        TEXT name
        TEXT status
        TEXT created_at
    }

    users {
        INTEGER id PK
        TEXT name
        TEXT email
        TEXT role
        INTEGER department_id FK
        TEXT designation
        TEXT avatar_url
        TEXT status
        TEXT created_at
        TEXT updated_at
    }

    reminder_policies {
        INTEGER id PK
        TEXT name
        INTEGER enabled
        REAL first_reminder_hours
        REAL second_reminder_hours
        REAL escalation_hours
        REAL deadline_reminder_hours
        INTEGER repeat_enabled
        TEXT created_at
        TEXT updated_at
    }

    tasks {
        TEXT id PK
        TEXT title
        TEXT description
        TEXT instructions
        INTEGER created_by FK
        TEXT priority
        TEXT start_at
        TEXT deadline_at
        TEXT status
        INTEGER progress_pct
        INTEGER reminder_policy_id FK
        INTEGER email_notifications_enabled
        TEXT last_progress_updated_at
        TEXT created_at
        TEXT updated_at
    }

    task_assignees {
        INTEGER id PK
        TEXT task_id FK
        INTEGER user_id FK
        TEXT responsibility_type
        TEXT assigned_at
        INTEGER active
    }

    task_updates {
        INTEGER id PK
        TEXT task_id FK
        INTEGER user_id FK
        TEXT old_status
        TEXT new_status
        TEXT remark
        INTEGER progress_pct
        TEXT created_at
    }

    task_comments {
        INTEGER id PK
        TEXT task_id FK
        INTEGER user_id FK
        TEXT comment
        TEXT created_at
    }

    task_reminders {
        INTEGER id PK
        TEXT task_id FK
        INTEGER recipient_user_id FK
        TEXT reminder_type
        TEXT scheduled_at
        TEXT sent_at
        TEXT status
        INTEGER attempt_count
        TEXT cycle_id
        TEXT metadata
    }

    sent_emails {
        INTEGER id PK
        TEXT task_id FK
        TEXT recipient_email
        TEXT recipient_name
        TEXT subject
        TEXT body_html
        TEXT event_type
        TEXT sent_at
    }

    audit_logs {
        INTEGER id PK
        TEXT task_id FK
        INTEGER actor_user_id FK
        TEXT action
        TEXT metadata
        TEXT created_at
    }

    departments ||--o{ users : "employs"
    users ||--o{ tasks : "creates"
    users ||--o{ task_assignees : "assigned_to"
    tasks ||--o{ task_assignees : "assigns"
    tasks ||--o{ task_updates : "history"
    tasks ||--o{ task_comments : "dialogue"
    tasks ||--o{ task_reminders : "reminder_events"
    tasks ||--o{ audit_logs : "audit_trail"
    reminder_policies ||--o{ tasks : "governs"
```

---

## 4. Key Implementation Highlights

### 4.1 Native Synchronous SQLite Engine
The backend eliminates asynchronous callback overhead and third-party compilation hurdles by utilizing Node 22's standard library `node:sqlite DatabaseSync`. All database operations execute predictably in sub-millisecond timeframes.

### 4.2 Deduplication Key Format
Cycle keys prevent duplicate emails during scheduler intervals:
- **First Inactivity Reminder:** `INACT_1_${task.id}_${task.last_progress_updated_at}`
- **Second Inactivity Reminder:** `INACT_2_${task.id}_${task.last_progress_updated_at}`
- **Founder Escalation:** `ESCALATE_${task.id}_${task.last_progress_updated_at}`
- **Deadline Approaching:** `DEADLINE_APPROACHING_${task.id}_${task.deadline_at}`
- **Deadline Overdue:** `DEADLINE_OVERDUE_${task.id}_${task.deadline_at.substring(0, 10)}`

Because the key incorporates the timestamp, any employee update automatically invalidates older keys without manual cleanup queries.

### 4.3 Time Travel Engine for Verification
The `system_config` table persists `simulated_now_offset_hours`. Both API requests and the background scheduler query `getEffectiveNow()` instead of bare system time:
```javascript
function getEffectiveNow() {
  const config = db.prepare('SELECT value FROM system_config WHERE key = ?').get('simulated_now_offset_hours');
  const offsetHours = config ? parseFloat(config.value) || 0 : 0;
  return new Date(Date.now() + offsetHours * 3600 * 1000);
}
```
This guarantees that time adjustments made in the simulation toolbar take immediate effect across all dashboard calculations and automated reminder sweeps.
