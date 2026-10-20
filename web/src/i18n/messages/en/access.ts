/**
 * Access feature strings (R16 task 16): the Accountant screen (Users tab and Access log tab)
 * under web/src/features/access/. runs/R09-accountant.md documents the underlying feature.
 */
export const access = {
  // AccessPage.tsx
  'access.title': 'Accountant',
  'access.tablistAriaLabel': 'Accountant',
  'access.tab.users': 'Users',
  'access.tab.log': 'Access log',

  // Shared owner-only gate (AccessLogTab.tsx, UsersTab.tsx)
  'access.ownerOnly': 'This area is for the account owner.',
  'access.loading': 'Loading',

  // AccessLogTab.tsx
  'access.log.errorFallback': 'Could not load the access log.',
  'access.log.caption': 'Accountant activity log',
  'access.log.colWhen': 'When',
  'access.log.colWho': 'Who',
  'access.log.colAction': 'Action',
  'access.log.colWhat': 'What',
  'access.log.colIp': 'IP',
  'access.log.systemFallback': 'system',
  'access.log.noneFallback': 'None',
  'access.log.loadOlder': 'Load older',

  // UsersTab.tsx
  'access.users.errorFallback': 'Could not load users.',
  'access.users.caption': 'Users with access to Open Ledger IL',
  'access.users.colEmail': 'Email',
  'access.users.colName': 'Name',
  'access.users.colRole': 'Role',
  'access.users.colStatus': 'Status',
  'access.users.colAccessEnds': 'Access ends',
  'access.users.colFeatures': 'Features',
  'access.users.noneFallback': 'None',
  'access.users.revoke': 'Revoke',
  'access.users.revokeConfirm': 'Remove {email} from this business? Someone left with no business loses the account.',
  'access.users.revokeSelfConfirm': 'Remove yourself from this business? You lose access to it.',
  'access.users.onlyOwner': 'The only owner. Add another owner to change this.',
  'access.users.actionError': 'The change did not go through.',
  'access.users.inviteAccountant': 'Invite someone',

  // Status labels (statusLabel())
  'access.status.owner': 'Owner',
  'access.status.disabled': 'Disabled',
  'access.status.expired': 'Expired',
  'access.status.active': 'Active',

  // Role labels
  'access.role.owner': 'Owner',
  'access.role.accountant': 'Accountant',

  // Feature checkbox labels (features.ts, shared by InviteForm.tsx and UsersTab.tsx)
  'access.feature.incomeDocuments': 'Income documents',
  'access.feature.expenses': 'Expenses',
  'access.feature.clients': 'Clients',
  'access.feature.reports': 'Reports',
  'access.feature.monthlyPack': 'Monthly pack',
  'access.feature.unifiedFile': 'Unified file',
  'access.feature.pcn874': 'PCN874',
  'access.feature.bankMatches': 'Bank matches',
  'access.feature.businessDocuments': 'Business documents',
  'access.feature.notes': 'Notes',

  // InviteForm.tsx
  'access.invite.ariaLabel': 'Invite someone',
  'access.invite.emailLabel': 'Email',
  'access.invite.nameLabel': 'Name',
  'access.invite.accessEndsOnLabel': 'Access ends on',
  'access.invite.featuresLegend': 'Features',
  'access.invite.errorFallback': 'Could not invite this accountant.',
  'access.invite.inviting': 'Inviting',
  'access.invite.sendInvite': 'Send invite',
  'access.invite.cancel': 'Cancel',
  'access.role.assistant': 'Assistant',
  'access.invite.roleLabel': 'Role',
  'access.roleHint.owner': 'Everything, including Settings, users and numbering.',
  'access.roleHint.assistant': 'Clients, quotes, payment requests, receipts, sending and expenses. No Settings, numbering, users or Tax Authority.',
  'access.roleHint.accountant': 'Reads what the switches allow, until the end date.',
  'access.users.roleFor': 'Role of {email}',
};
