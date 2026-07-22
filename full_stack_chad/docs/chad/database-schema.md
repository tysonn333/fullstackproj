# Chad - Database Schema

## Relationships

```text
auth.users
    1
    |
    1
 efar_user_roles

staff_members
    1
    |------< part_timer_availability
    |
    |------< scheduling_exceptions
                         1
                         |
                         |------< exception_audit_log
```

## `staff_members`

Stores staff details used by scheduling. This feature reads active records where `employment_type` is `part_time`.

Primary key: `id`  
Unique key: `staff_code`

## `part_timer_availability`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `staff_id` | UUID | Foreign key to `staff_members` |
| `available_date` | Date | Calendar date |
| `period` | Text | AM, PM, FULL_DAY or CUSTOM |
| `start_time` | Time | Must be earlier than end time |
| `end_time` | Time | Must be later than start time |
| `note` | Text | Optional operations note |
| `coverage_gap` | Boolean | Creates a half-day gap flag when applicable |
| `deleted_at` | Timestamp | Soft deletion |
| `created_at` | Timestamp | Creation time |
| `updated_at` | Timestamp | Last change time |

An application-level overlap check prevents the same part-timer from having conflicting periods on the same date.

## `scheduling_exceptions`

Stores active and completed scheduling flags. Status values are `active`, `deferred`, `resolved`, `dismissed` and `rejected`.

The composite index on status, severity, date and start time supports the main exceptions list.

## `exception_audit_log`

Stores one immutable entry for each exception action. It records the action, old status, new status, note, user email and time.

## `efar_user_roles`

Links a Supabase Auth user to an application role. The scheduling tables use this relationship in row-level security policies.
