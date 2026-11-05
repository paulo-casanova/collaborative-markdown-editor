import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { EditorPage } from './pages/EditorPage';
import { ReaderPage } from './pages/ReaderPage';
import { TrashPage } from './pages/TrashPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { TaskDashboardPage } from './pages/TaskDashboardPage';
import { TagsPage } from './pages/TagsPage';
import { CheckedOutPage } from './pages/CheckedOutPage';
import { TestEditorPage } from './pages/TestEditorPage';
import { TestCollabPage } from './pages/TestCollabPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<TaskDashboardPage />} />
            <Route path="documents/by-path" element={<EditorPage />} />
            <Route path="documents/:id" element={<EditorPage />} />
            <Route path="documents/*" element={<EditorPage />} />
            <Route path="doc/:id" element={<EditorPage />} />
            <Route path="d/:id" element={<EditorPage />} />
            <Route path="docs/by-path" element={<ReaderPage />} />
            <Route path="docs/:id" element={<ReaderPage />} />
            <Route path="docs/*" element={<ReaderPage />} />
            <Route path="tasks" element={<TaskDashboardPage />} />
            <Route path="mentions" element={<TaskDashboardPage initialTab="mentions" />} />
            <Route path="comments" element={<TaskDashboardPage initialTab="comments" />} />
            <Route path="suggestions" element={<TaskDashboardPage initialTab="suggestions" />} />
            <Route path="tags" element={<TagsPage />} />
            <Route path="tags/:tag" element={<TagsPage />} />
            <Route path="checked-out" element={<CheckedOutPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="test-editor" element={<TestEditorPage />} />
            <Route path="test-collab" element={<TestCollabPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
