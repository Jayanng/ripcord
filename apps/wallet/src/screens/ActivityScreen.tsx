import { SearchDrawer } from '../components/SearchDrawer';
import { ActivityFeed } from '../components/ActivityFeed';

export function ActivityScreen() {
  return (
    <section className="activity-section">
      <SearchDrawer />
      <ActivityFeed />
    </section>
  );
}
