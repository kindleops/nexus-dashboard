import type { ReactNode } from 'react'
import { LiveDashboardPage } from '../modules/dashboard/live/LiveDashboardPage'
import { loadLiveDashboard } from '../modules/dashboard/live/load-live-dashboard'
import type { LiveDashboardModel } from '../modules/dashboard/live/live-dashboard.adapter'
import { InboxPage } from '../modules/inbox/InboxPage'
import { loadInbox } from '../modules/inbox/inbox.adapter'
import type { InboxModel } from '../modules/inbox/inbox.adapter'
import { AlertsPage } from '../modules/alerts/AlertsPage'
import { loadAlerts } from '../modules/alerts/alerts.adapter'
import type { AlertsModel } from '../modules/alerts/alerts.adapter'
import { StatsPage } from '../modules/stats/StatsPage'
import { loadStats } from '../modules/stats/stats.adapter'
import type { StatsModel } from '../modules/stats/stats.adapter'
import { MarketsPage } from '../modules/markets/MarketsPage'
import { loadMarkets } from '../modules/markets/markets.adapter'
import type { MarketsModel } from '../modules/markets/markets.adapter'
import { BuyerIntelPage } from '../modules/buyer/BuyerIntelPage'
import { loadBuyer } from '../modules/buyer/buyer.adapter'
import type { BuyerModel } from '../modules/buyer/buyer.adapter'
import { TitleWarRoomPage } from '../modules/title/TitleWarRoomPage'
import { loadTitle } from '../modules/title/title.adapter'
import type { TitleModel } from '../modules/title/title.adapter'
import { SettingsPage } from '../modules/settings/SettingsPage'
import { NotificationsPage } from '../modules/notifications/NotificationsPage'
import { loadNotifications } from '../modules/notifications/notifications.adapter'
import type { NotificationsModel } from '../modules/notifications/notifications.adapter'
import { WatchlistsPage } from '../modules/watchlists/WatchlistsPage'
import { loadWatchlists } from '../modules/watchlists/watchlists.adapter'
import type { WatchlistsModel } from '../modules/watchlists/watchlists.adapter'

interface AppRoute<TData> {
  path: string
  title: string
  loader: () => Promise<TData>
  render: (data: TData) => ReactNode
}

export interface ResolvedRoute {
  path: string
  title: string
  loader: () => Promise<unknown>
  render: (data: unknown) => ReactNode
}

const defineRoute = <TData,>(route: AppRoute<TData>): ResolvedRoute => ({
  path: route.path,
  title: route.title,
  loader: route.loader as () => Promise<unknown>,
  render: (data) => route.render(data as TData),
})

const liveDashboardRoute = defineRoute<LiveDashboardModel>({
  path: '/dashboard/live',
  title: 'NEXUS | Live Command Center',
  loader: loadLiveDashboard,
  render: (data) => <LiveDashboardPage data={data} />,
})

const inboxRoute = defineRoute<InboxModel>({
  path: '/inbox',
  title: 'NEXUS | Inbox',
  loader: loadInbox,
  render: (data) => <InboxPage data={data} />,
})

const alertsRoute = defineRoute<AlertsModel>({
  path: '/alerts',
  title: 'NEXUS | Alerts',
  loader: loadAlerts,
  render: (data) => <AlertsPage data={data} />,
})

const statsRoute = defineRoute<StatsModel>({
  path: '/stats',
  title: 'NEXUS | Intelligence Dashboard',
  loader: loadStats,
  render: (data) => <StatsPage data={data} />,
})

const marketsRoute = defineRoute<MarketsModel>({
  path: '/markets',
  title: 'NEXUS | Active Markets',
  loader: loadMarkets,
  render: (data) => <MarketsPage data={data} />,
})

const buyerRoute = defineRoute<BuyerModel>({
  path: '/buyer',
  title: 'NEXUS | Buyer Intelligence',
  loader: loadBuyer,
  render: (data) => <BuyerIntelPage data={data} />,
})

const titleRoute = defineRoute<TitleModel>({
  path: '/title',
  title: 'NEXUS | Title & Closing',
  loader: loadTitle,
  render: (data) => <TitleWarRoomPage data={data} />,
})

const settingsRoute = defineRoute<null>({
  path: '/settings',
  title: 'NEXUS | Settings',
  loader: async () => null,
  render: () => <SettingsPage />,
})

const notificationsRoute = defineRoute<NotificationsModel>({
  path: '/notifications',
  title: 'NEXUS | Notifications',
  loader: loadNotifications,
  render: (data) => <NotificationsPage data={data} />,
})

const watchlistsRoute = defineRoute<WatchlistsModel>({
  path: '/watchlists',
  title: 'NEXUS | Watchlists',
  loader: loadWatchlists,
  render: (data) => <WatchlistsPage data={data} />,
})

const routes = [
  liveDashboardRoute,
  inboxRoute,
  alertsRoute,
  statsRoute,
  marketsRoute,
  buyerRoute,
  titleRoute,
  settingsRoute,
  notificationsRoute,
  watchlistsRoute,
]

export const resolveRoute = (path: string) =>
  routes.find((route) => route.path === path) ?? liveDashboardRoute
