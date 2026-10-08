const terminalStatuses = new Set(['Completed', 'Approved', 'Cancelled']);

const employeeTransitions = {
  New: ['Acknowledged', 'In Progress'],
  Acknowledged: ['In Progress', 'Awaiting Information', 'On Hold', 'Submitted for Review', 'Completed'],
  'In Progress': ['Awaiting Information', 'On Hold', 'Submitted for Review', 'Completed'],
  'Awaiting Information': ['In Progress', 'On Hold', 'Submitted for Review', 'Completed'],
  'On Hold': ['In Progress', 'Awaiting Information', 'Completed'],
  'Submitted for Review': ['In Progress', 'Completed'],
  'Rework Required': ['In Progress', 'Awaiting Information', 'On Hold', 'Submitted for Review', 'Completed'],
  Completed: [],
  Approved: [],
  Cancelled: []
};

const managementTransitions = Object.fromEntries(
  Object.entries(employeeTransitions).map(([status, nextStatuses]) => [
    status,
    status === 'Completed'
      ? ['Rework Required', 'Approved']
      : terminalStatuses.has(status)
        ? []
        : [...nextStatuses, 'Rework Required', 'Approved', 'Cancelled']
  ])
);

function getAllowedNextStatuses(currentStatus, role) {
  const transitions = role === 'employee'
    ? employeeTransitions
    : ['founder', 'admin'].includes(role)
      ? managementTransitions
      : {};
  const nextStatuses = transitions[currentStatus] || [];
  if (terminalStatuses.has(currentStatus) && role === 'employee') return [];
  return terminalStatuses.has(currentStatus)
    ? [currentStatus, ...nextStatuses]
    : [currentStatus, ...nextStatuses];
}

function isStatusTransitionAllowed(currentStatus, nextStatus, role) {
  if (nextStatus === currentStatus) return role !== 'employee' || !terminalStatuses.has(currentStatus);
  return getAllowedNextStatuses(currentStatus, role).includes(nextStatus);
}

module.exports = {
  employeeTransitions,
  managementTransitions,
  terminalStatuses,
  getAllowedNextStatuses,
  isStatusTransitionAllowed
};