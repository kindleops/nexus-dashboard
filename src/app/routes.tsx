import type { ReactNode } from 'react'
import { LiveDashboardPage } from '../modules/dashboard/live/LiveDashboardPage'
import { loadLiveDashboard } from '../modules/dashboard/live/load-live-dashboard'
import type { LiveDashboardModel } from '../modules/dashboard/live/live-dashboard.adapter'

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

const routes = [liveDashboardRoute]

export const resolveRoute = (path: string) =>
  routes.find((route) => route.path === path) ?? liveDashboardRoute
