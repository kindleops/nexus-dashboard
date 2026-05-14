import { getSupabaseClient } from '../../../../src/lib/supabaseClient'
import { asString, asNumber } from '../../../../src/lib/data/shared'

type ApiRequest = {
  method?: string
  query?: Record<string, string | string[]>
  body?: unknown
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const supabase = getSupabaseClient()
    
    // Extract params from query (GET) or body (POST)
    const params = req.method === 'GET' ? req.query : (req.body as Record<string, any>)
    
    const start_date = asString(params?.start_date, null)
    const end_date = asString(params?.end_date, null)
    const market = asString(params?.market, null)
    const agent_id = asString(params?.agent_id, null)
    const language = asString(params?.language, null)
    const min_sent = asNumber(params?.min_sent, 1)
    const include_raw = params?.include_raw === 'true' || params?.include_raw === true

    const { data, error } = await supabase.rpc('get_ownership_check_template_stats', {
      start_date,
      end_date,
      p_market_id: market,
      p_agent_id: agent_id,
      p_language: language,
      p_min_sent: min_sent
    })

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    // Process and return
    res.status(200).json({
      success: true,
      count: data?.length || 0,
      filters: {
        start_date,
        end_date,
        market,
        agent_id,
        language,
        min_sent
      },
      data: data || []
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    })
  }
}
