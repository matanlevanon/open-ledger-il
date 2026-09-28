import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useT } from '../../i18n';
import type { FeatureRoute } from '../index';
import { ClientsArea } from './Clients';
import { DocumentListPage } from './DocumentList';
import { DocumentPage } from './DocumentPage';
import { DocumentEditor } from './Editor';
import { StatementsPage } from './Ledger';
import { Card, PageTitle } from './ui';

function DocumentsArea() {
  const t = useT();
  return (
    <Routes>
      <Route
        // R18 task 10: 300 moved to the Proformas route below (it is the one proforma type now);
        // this list keeps receipts and credits only.
        index
        element={<DocumentListPage title={t('documents.list.title')} types="400,405" newPath="/income/documents/new?type=400" newLabel={t('documents.list.newReceipt')} />}
      />
      <Route path=":id/edit" element={<DocumentEditor />} />
      <Route path=":id" element={<DocumentPage />} />
    </Routes>
  );
}

function Quotes() {
  const t = useT();
  return <DocumentListPage title={t('documents.quotesRoute.title')} types="QT" newPath="/income/quotes/new" newLabel={t('documents.quotesRoute.newQuote')} hasUnpaid={false} />;
}
function Requests() {
  const t = useT();
  return <DocumentListPage title={t('documents.requestsRoute.title')} types="PR" newPath="/income/payment-requests/new" newLabel={t('documents.requestsRoute.newRequest')} />;
}
// R18 task 10: 300 is the one proforma type now; PF stays listed here too (types="300,PF") so an
// already-finalized PF document, disabled for new use but never hidden, stays browsable.
function Proformas() {
  const t = useT();
  return <DocumentListPage title={t('documents.proformasRoute.title')} types="300,PF" newPath="/income/proformas/new" newLabel={t('documents.proformasRoute.newProforma')} />;
}
const NewQuote = () => <DocumentEditor type="QT" />;
const NewRequest = () => <DocumentEditor type="PR" />;
const NewProforma = () => <DocumentEditor type="300" />;
function NewDocument() {
  const t = useT();
  const type = new URLSearchParams(useLocation().search).get('type');
  if (type !== '405') return <DocumentEditor />;
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-3xl">
      <PageTitle>{t('documents.newCreditReceipt.title')}</PageTitle>
      <Card>
        <p className="text-sm">{t('documents.newCreditReceipt.body')}</p>
        <Link to="/income/documents" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
          {t('documents.newCreditReceipt.link')}
        </Link>
      </Card>
    </section>
  );
}
const IncomeHome = () => <Navigate to="/income/documents" replace />;

/** R01 screens. Paths shadow the shell placeholders, including the Create new targets. */
export const documentsRoutes: FeatureRoute[] = [
  { path: '/clients/*', component: ClientsArea },
  { path: '/income', component: IncomeHome },
  { path: '/income/quotes', component: Quotes },
  { path: '/income/quotes/new', component: NewQuote },
  { path: '/income/payment-requests', component: Requests },
  { path: '/income/payment-requests/new', component: NewRequest },
  { path: '/income/proformas', component: Proformas },
  { path: '/income/proformas/new', component: NewProforma },
  { path: '/income/documents/*', component: DocumentsArea },
  { path: '/income/documents/new', component: NewDocument },
  { path: '/income/statements', component: StatementsPage },
];
