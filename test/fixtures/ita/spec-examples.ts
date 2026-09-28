/**
 * Response examples copied from the ITA specs, with the PDF typos in the JSON fixed
 * (missing quotes and braces). Sources:
 *   vat_software-houses-180724-en.pdf (API v2.0, July 2024): pages 13-14, 18-22, 32.
 *   vat_software-houses-290726.pdf (addendum June 2026): pages 5 and 7.
 */

export const APPROVAL_APPROVED = {
  status: 200,
  message: 'Invoice approved',
  confirmation_number: '20240627231846297178091822',
  approved: true,
};

export const APPROVAL_460 = {
  status: 200,
  message: { errors: [{ code: 460, message: 'Invoice not approved', param: 'vat_number', location: 'approval' }] },
  confirmation_number: '0',
  approved: false,
};

export const APPROVAL_461 = {
  status: 200,
  message: {
    errors: [{ code: 461, message: 'The unapproved invoice exists. No decision was sent', param: 'invoice_id', location: 'approval' }],
  },
  confirmation_number: '0',
  approved: false,
};

export const APPROVAL_462 = {
  status: 200,
  message: {
    errors: [{ code: 462, message: 'The unapproved invoice exists and decision was sent.', param: 'vat_number', location: 'approval' }],
  },
  confirmation_number: '0',
  approved: false,
};

export const APPROVAL_434 = {
  status: 400,
  message: { errors: [{ code: 434, message: 'Invoice date is too old for approval', param: 'invoice_date', location: 'request' }] },
  confirmation_number: '0',
  approved: false,
};

export const APPROVAL_431 = {
  status: 400,
  message: { errors: [{ code: 431, message: 'VAT Number is incorrect', param: 'vat_number', location: 'request' }] },
  confirmation_number: '0',
  approved: false,
};

export const APPROVAL_435 = {
  status: 400,
  message: { errors: [{ code: 435, message: 'Invoice date is more than a month ahead', param: 'invoice_date', location: 'request' }] },
  confirmation_number: '0',
  approved: false,
};

export const APPROVAL_446 = {
  status: 400,
  message: {
    errors: [{ code: 446, message: 'Requeried one of the two fields: user ID or user name', param: 'user_id / user_name', location: 'request' }],
  },
  confirmation_number: '0',
  approved: false,
};

/** MultiApproval example 1: 200 with refusals and data errors, no success list. */
export const MULTI_EXAMPLE_1 = {
  status: 200,
  transaction_id: '20240710180901538191089823',
  is_error_in_main: false,
  vat_number: 777777715,
  union_vat_number: 0,
  message: {
    errors: [
      { invoice_id: '8748489', message: APPROVAL_460.message, confirmation_number: '0', approved: false },
      {
        invoice_id: '14325366',
        message: {
          errors: [
            { code: 462, message: 'The unapproved invoice exists and decision was sent', param: 'invoice_id', location: 'approval' },
            APPROVAL_446.message.errors[0],
          ],
        },
        confirmation_number: '0',
        approved: false,
      },
      { invoice_id: '68767687687', message: APPROVAL_435.message, confirmation_number: '0', approved: false },
      { invoice_id: '68787687687', message: APPROVAL_434.message, confirmation_number: '0', approved: false },
    ],
  },
};

/** MultiApproval example 2: 200 with successes and errors. */
export const MULTI_EXAMPLE_2 = {
  status: 200,
  transaction_id: '20240710181229229191035598',
  is_error_in_main: false,
  vat_number: 777777715,
  union_vat_number: 0,
  message: {
    errors: [
      { invoice_id: '798798687', message: APPROVAL_460.message, confirmation_number: '0', approved: false },
      { invoice_id: '68787687687', message: APPROVAL_434.message, confirmation_number: '0', approved: false },
    ],
    success: [
      { invoice_id: '68768757858', confirmation_number: '20240710181226272191063077', approved: true },
      { invoice_id: '6876876875', confirmation_number: '20240710181228052191084625', approved: true },
    ],
  },
};

/** MultiApproval 400: every invoice has wrong data. */
export const MULTI_400_INVOICES = {
  status: 400,
  transaction_id: '20240710175514166191010348',
  is_error_in_main: false,
  vat_number: 777777715,
  union_vat_number: 0,
  message: {
    errors: [
      {
        invoice_id: '14325366',
        message: { errors: [APPROVAL_434.message.errors[0], APPROVAL_446.message.errors[0]] },
        confirmation_number: '0',
        approved: false,
      },
      { invoice_id: '6875875858', message: APPROVAL_435.message, confirmation_number: '0', approved: false },
      { invoice_id: '745687685765', message: APPROVAL_434.message, confirmation_number: '0', approved: false },
    ],
  },
};

/** MultiApproval 400: table 2.6 summary is wrong (438), is_error_in_main true. */
export const MULTI_400_MAIN = {
  status: 400,
  transaction_id: '20240710174347464191078947',
  is_error_in_main: true,
  vat_number: 777777715,
  union_vat_number: 0,
  message: {
    errors: [
      {
        invoice_id: '0',
        message: {
          errors: [{ code: 438, message: 'Invoices amount is not the same as actual invoices amount', param: 'invoices_amount', location: 'request' }],
        },
        confirmation_number: '0',
        approved: false,
      },
    ],
  },
};

export const DECISION_ACCEPTED = { status: 200, message: 'Decision accepted' };

export const DECISION_463 = {
  status: 400,
  message: { errors: [{ code: 463, message: 'No matching unapproved invoice found', param: 'invoice_id', location: 'request' }] },
};

export const DETAILS_OK = {
  status: 200,
  message: {
    invoice_type: 305,
    vat_number: 777777715,
    union_vat_number: 777777749,
    invoice_reference_number: 'invoice_reference_number',
    customer_vat_number: 18,
    customer_name: 'לקוח לדוגמה',
    invoice_date: '2025-05-20',
    invoice_issuance_date: '2025-05-20',
    amount_before_discount: 552.75,
    discount: 52.75,
    payment_amount_including_vat: 585,
    payment_amount: 500,
    vat_amount: 85,
    invoice_note: 'הערה כללית',
    items: [
      {
        index: 999999,
        catalog_id: '55678956',
        category: 15,
        description: 'תאור הפריט',
        measure_unit_description: 'kg',
        quantity: 100.5,
        price_per_unit: 500,
        discount: 52.751,
        total_amount: 500,
        vat_rate: 18,
        vat_amount: 85,
      },
    ],
  },
};

export const LOOKUP_472 = {
  status: 400,
  message: { errors: [{ code: 472, message: 'Cannot retrieve information', param: 'body', location: 'request' }] },
};

export const CONFIRMATION_OK = {
  status: 200,
  message: 'Invoice confirmation number for the received data is: 20260429140042271119068285',
  confirmation_number: '20260429140042271119068285',
};

/** Chapter 5 HTTP errors, with the "More Information" text as the body message. */
export const HTTP_ERRORS: Record<number, string> = {
  401: 'Cannot pass the security checks that are required by the target API or operation, Enable debug headers for more details',
  403: "You don't have permission to access this service",
  404: 'No resources match requested URI',
  406: 'Server cannot fulfill request',
  422: 'Validate all objects sent according to schema',
  500: 'Error_Id',
};
