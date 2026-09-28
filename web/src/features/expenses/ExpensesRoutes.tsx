import { Route, Routes } from 'react-router-dom';
import { CategoriesPage } from './CategoriesPage';
import { ExpenseReviewPage } from './ExpenseReviewPage';
import { ExpensesListPage } from './ExpensesListPage';
import { SuppliersPage } from './SuppliersPage';

export function ExpensesRoutes() {
  return (
    <Routes>
      <Route index element={<ExpensesListPage />} />
      <Route path="suppliers" element={<SuppliersPage />} />
      <Route path="categories" element={<CategoriesPage />} />
      <Route path=":id" element={<ExpenseReviewPage />} />
    </Routes>
  );
}
