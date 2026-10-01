import { SearchDrawer } from '../components/SearchDrawer';
import { ActivityFeed } from '../components/ActivityFeed';
import { PullToRefresh } from '../components/PullToRefresh';
import { useWallet } from '../context/WalletContext';

export function ActivityScreen() {
  const wallet = useWallet();
  return (
    <section className="activity-section">
      <SearchDrawer />
      <PullToRefresh onRefresh={() => wallet.refresh()}>
        <ActivityFeed />
      </PullToRefresh>
    </section>
  );
}
