# Chad - Use Cases

## UC-003A: Record part-timer availability

**Actor:** Admin or operations staff  
**Purpose:** Keep part-timer availability in one calendar so the scheduling process can include them.

### Main flow

1. The user chooses a part-timer, date and available period.
2. The system validates the start and end time.
3. The system checks for an overlapping availability record.
4. The record is saved and displayed on the monthly calendar.
5. The user may edit or remove the record later.

### Other flows

- A full-day, AM, PM or custom period can be recorded.
- The WhatsApp button opens a prepared availability confirmation message.
- A half-day record can also create a coverage-gap exception for the uncovered period.
- Removing an entry uses soft deletion so the original database row is retained.

### Errors

- Unknown or inactive part-timer: record is rejected.
- Start time is later than end time: record is rejected.
- Overlapping period for the same person and date: record is rejected.
- No phone number: WhatsApp contact is blocked with an error message.

## UC-008A: Review and action scheduling exceptions

**Actor:** Admin or operations staff  
**Purpose:** Handle unresolved staffing issues and keep a record of decisions.

### Main flow

1. The user opens the exceptions page.
2. The system lists critical, warning and informational flags in priority order.
3. The user filters the list by status, severity or type.
4. The user resolves, defers, dismisses, rejects or reopens an exception.
5. The system saves the updated status and an audit entry.

### Other flows

- Multiple exceptions can be selected and actioned together.
- Filtered records can be exported as CSV.
- Audit history can be viewed for each exception.
- A browser notification can be requested as a fallback alert.

### Errors

- Dismissal or rejection without a clear reason: action is rejected.
- Deferral without a review date: action is rejected.
- Invalid or expired session: access is denied.
- Missing scheduling role: access is denied.
