import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TagsView } from '../components/tags/TagsView';
import { useUIStore } from '../stores/uiStore';

export const TagsPage: React.FC = () => {
  const { tag } = useParams<{ tag?: string }>();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useUIStore();

  useEffect(() => {
    if (tag) {
      setBreadcrumbs([
        { label: 'Tags', path: '/tags' },
        { label: `#${tag}`, path: `/tags/${encodeURIComponent(tag)}`, isCurrent: true },
      ]);
    } else {
      setBreadcrumbs([{ label: 'Tags', path: '/tags', isCurrent: true }]);
    }
  }, [tag, setBreadcrumbs]);

  const handleSelectTag = (selected: string) => {
    navigate(`/tags/${encodeURIComponent(selected)}`);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TagsView selectedTag={tag} onSelectTag={handleSelectTag} />
    </div>
  );
};

export default TagsPage;
