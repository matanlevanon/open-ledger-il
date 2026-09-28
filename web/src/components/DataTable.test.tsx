import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable } from './DataTable';

interface Row {
  id: number;
  name: string;
  status: 'draft' | 'final';
  amount: number;
}

const rows: Row[] = [
  { id: 1, name: 'Example Client Ltd', status: 'final', amount: 500 },
  { id: 2, name: 'Northwind Traders', status: 'draft', amount: 120 },
  { id: 3, name: 'Blue Bottle Coffee', status: 'final', amount: 75 },
];

function renderTable() {
  return render(
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: 'name', header: 'Client', render: (r) => r.name },
        { key: 'amount', header: 'Amount', render: (r) => String(r.amount), align: 'right' },
      ]}
      searchText={(r) => [r.name]}
      tabs={[
        { key: 'all', label: 'All', predicate: () => true },
        { key: 'final', label: 'Final', predicate: (r) => r.status === 'final' },
        { key: 'draft', label: 'Draft', predicate: (r) => r.status === 'draft' },
      ]}
    />,
  );
}

describe('DataTable', () => {
  it('shows every row on the default tab', () => {
    renderTable();
    for (const row of rows) expect(screen.getByText(row.name)).toBeInTheDocument();
  });

  it('filters rows by the search box', () => {
    renderTable();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'blue' } });
    expect(screen.getByText('Blue Bottle Coffee')).toBeInTheDocument();
    expect(screen.queryByText('Example Client Ltd')).not.toBeInTheDocument();
    expect(screen.queryByText('Northwind Traders')).not.toBeInTheDocument();
  });

  it('filters rows by tab', () => {
    renderTable();
    fireEvent.click(screen.getByRole('tab', { name: 'Draft' }));
    expect(screen.getByText('Northwind Traders')).toBeInTheDocument();
    expect(screen.queryByText('Example Client Ltd')).not.toBeInTheDocument();
    expect(screen.queryByText('Blue Bottle Coffee')).not.toBeInTheDocument();
  });

  it('combines the active tab with the search box', () => {
    renderTable();
    fireEvent.click(screen.getByRole('tab', { name: 'Final' }));
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'blue' } });
    expect(screen.getByText('Blue Bottle Coffee')).toBeInTheDocument();
    expect(screen.queryByText('Example Client Ltd')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', () => {
    renderTable();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'no such client' } });
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });
});
