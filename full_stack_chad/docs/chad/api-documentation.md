# Chad - API Documentation

Base path: `/api`

All routes except health and login require a bearer token and an `admin` or `operations` role.

## Authentication

### POST `/auth/login`

Request:

```json
{
  "email": "chad@efar.local",
  "password": "chad1234"
}
```

Success: `200`

```json
{
  "token": "jwt-token",
  "user": {
    "id": "user-chad",
    "email": "chad@efar.local",
    "role": "admin",
    "name": "Chad"
  }
}
```

Errors: `401` incorrect credentials, `409` Supabase authentication is active, `422` invalid request.

## Part-timer staff

### GET `/staff`

Returns active part-time staff records.

Success: `200`  
Errors: `401`, `403`.

## Availability

### GET `/availability?month=2026-07&staff_id={id}`

Returns non-deleted availability records for a month. `staff_id` is optional.

### POST `/availability`

```json
{
  "staff_id": "staff-uuid",
  "available_date": "2026-07-18",
  "period": "AM",
  "start_time": "06:00",
  "end_time": "12:00",
  "note": "Available before class",
  "coverage_gap": true
}
```

Success: `201`  
Errors: `404` staff not found, `409` overlap, `422` invalid data.

### PUT `/availability/{id}`

Uses the same fields as create and returns the updated record.

Success: `200`  
Errors: `404`, `409`, `422`.

### DELETE `/availability/{id}`

Soft-deletes the record.

Success: `204`  
Errors: `404`.

### POST `/availability/{id}/whatsapp`

```json
{
  "message": "Can you confirm your availability?"
}
```

The message is optional. The response contains a `wa.me` URL.

Success: `200`  
Errors: `404` record not found, `422` phone number missing.

## Exceptions

### GET `/exceptions`

Optional query values: `status`, `severity`, `type`, `from`, `to`.

### PATCH `/exceptions/{id}/action`

```json
{
  "action": "defer",
  "note": "Waiting for the part-timer to confirm",
  "deferred_until": "2026-07-19"
}
```

Actions: `resolve`, `defer`, `dismiss`, `reject`, `reopen`.

Success: `200`  
Errors: `404` exception not found, `422` invalid action or missing reason/date.

### POST `/exceptions/bulk-action`

```json
{
  "ids": ["exception-1", "exception-2"],
  "action": "resolve",
  "note": "Covered by the updated roster"
}
```

Success: `200` with the updated count.  
Errors: `422` invalid or empty selection.

### GET `/exceptions/{id}/audit`

Returns the status history for one exception.

### GET `/exceptions/export.csv`

Uses the same filters as the exceptions list and returns a CSV file.

### POST `/exceptions/{id}/notify`

Returns a title, body and tag for the frontend browser notification.

## Common errors

```json
{ "error": "Authentication required" }
```

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "available_date", "message": "Invalid" }
  ]
}
```
