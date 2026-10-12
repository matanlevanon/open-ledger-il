import { Route, Routes } from 'react-router-dom';
import { ContractEditor } from './ContractEditor';
import { ContractPage } from './ContractPage';

/** R25: /contracts/new, /contracts/:id/edit, /contracts/:id. */
export function ContractsRoutes() {
  return (
    <Routes>
      <Route path="new" element={<ContractEditor />} />
      <Route path=":id/edit" element={<ContractEditor />} />
      <Route path=":id" element={<ContractPage />} />
    </Routes>
  );
}

export { ClientContracts } from './ClientContracts';
export { ContractTemplatesTab } from './ContractTemplatesTab';
