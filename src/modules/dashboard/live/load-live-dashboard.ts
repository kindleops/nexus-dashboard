import { loadCommandCenterStore } from '../../../domain/normalize-command-center'
import { adaptLiveDashboardModel } from './live-dashboard.adapter'

let liveDashboardPromise: Promise<ReturnType<typeof adaptLiveDashboardModel>> | null = null

export const loadLiveDashboard = () => {
  if (liveDashboardPromise) {
    return liveDashboardPromise
  }

  liveDashboardPromise = loadCommandCenterStore().then((store) => adaptLiveDashboardModel(store))
  return liveDashboardPromise
}
