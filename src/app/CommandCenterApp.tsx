import { startTransition, useEffect, useState } from 'react'
import { replaceRoutePath, useRoutePath } from './router'
import { resolveRoute } from './routes'

interface RouteLoadState {
  status: 'loading' | 'ready' | 'error'
  path: string
  data: unknown
  message: string
}

const initialState: RouteLoadState = {
  status: 'loading',
  path: '',
  data: null,
  message: '',
}

export const CommandCenterApp = () => {
  const path = useRoutePath()
  const route = resolveRoute(path)
  const [routeState, setRouteState] = useState<RouteLoadState>({
    ...initialState,
    path: route.path,
  })

  useEffect(() => {
    document.title = route.title
  }, [route.title])

  useEffect(() => {
    let active = true

    route
      .loader()
      .then((data) => {
        if (!active) {
          return
        }

        startTransition(() => {
          setRouteState({
            status: 'ready',
            path: route.path,
            data,
            message: '',
          })
        })
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }

        const message = error instanceof Error ? error.message : 'Unknown route loader error'
        setRouteState({
          status: 'error',
          path: route.path,
          data: null,
          message,
        })
      })

    return () => {
      active = false
    }
  }, [route])

  const isRouteLoading = routeState.path !== route.path || routeState.status === 'loading'

  if (isRouteLoading) {
    return (
      <main className="app-state">
        <div className="app-state__panel">
          <span className="app-state__eyebrow">NEXUS</span>
          <h1>Initializing command center</h1>
          <p>Loading live route intelligence for `{route.path}`.</p>
        </div>
      </main>
    )
  }

  if (routeState.status === 'error') {
    return (
      <main className="app-state">
        <div className="app-state__panel">
          <span className="app-state__eyebrow">Route Error</span>
          <h1>Unable to load the live dashboard</h1>
          <p>{routeState.message}</p>
          <button
            className="app-state__button"
            type="button"
            onClick={() => {
              replaceRoutePath('/dashboard/live')
            }}
          >
            Retry live route
          </button>
        </div>
      </main>
    )
  }

  return <main className="app-root">{route.render(routeState.data)}</main>
}
