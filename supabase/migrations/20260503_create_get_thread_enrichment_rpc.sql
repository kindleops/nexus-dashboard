-- ============================================================
-- RPC: get_thread_enrichment
-- Returns owner/property enrichment data for inbox threads.
-- SECURITY DEFINER bypasses RLS so the anon key can access data.
-- ============================================================

drop function if exists public.get_thread_enrichment(text[]);

create or replace function public.get_thread_enrichment(p_thread_keys text[])
returns table (
  thread_key text,
  property_id text,
  master_owner_id text,
  prospect_id text,
  -- Owner / Seller fields
  owner_display_name text,
  seller_first_name text,
  seller_last_name text,
  owner_type text,
  contact_language text,
  best_phone text,
  phone_confidence text,
  -- Property fields
  property_address_full text,
  property_street text,
  property_city text,
  property_state text,
  property_zip text,
  property_type text,
  market_name text,
  beds numeric,
  baths numeric,
  sqft numeric,
  year_built numeric,
  effective_year_built numeric,
  estimated_value numeric,
  cash_offer numeric,
  equity_amount numeric,
  equity_percent numeric,
  estimated_repair_cost numeric,
  final_acquisition_score numeric,
  motivation_score numeric,
  motivation_summary text,
  deal_next_step text,
  podio_tags text,
  is_owner_occupied boolean,
  is_absentee boolean,
  is_vacant boolean,
  has_lien boolean,
  is_probate boolean,
  is_tax_delinquent boolean,
  streetview_image text,
  zillow_url text,
  realtor_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_key text;
  v_property_id text;
  v_owner_id text;
  v_prospect_id text;
  v_market text;
  v_property_address text;
begin
  -- Process each thread key
  foreach v_thread_key in array p_thread_keys loop
    -- Extract IDs from thread_key format (phone:xxx, owner:xxx, prospect:xxx, property:xxx, event:xxx)
    if v_thread_key like 'phone:%' then
      -- For phone-based threads, look up latest message_event
      select me.property_id, me.master_owner_id, me.prospect_id, me.market, me.property_address
      into v_property_id, v_owner_id, v_prospect_id, v_market, v_property_address
      from public.message_events me
      where (
        me.canonical_e164 = substring(v_thread_key from 7)
        or me.seller_phone = substring(v_thread_key from 7)
        or (me.direction = 'inbound' and me.from_phone_number = substring(v_thread_key from 7))
        or (me.direction = 'outbound' and me.to_phone_number = substring(v_thread_key from 7))
      )
      order by me.event_timestamp desc
      limit 1;
    elsif v_thread_key like 'owner:%' then
      v_owner_id := substring(v_thread_key from 7);
      select me.property_id, me.prospect_id, me.market, me.property_address
      into v_property_id, v_prospect_id, v_market, v_property_address
      from public.message_events me
      where me.master_owner_id = v_owner_id
      order by me.event_timestamp desc
      limit 1;
    elsif v_thread_key like 'prospect:%' then
      v_prospect_id := substring(v_thread_key from 8);
      select me.property_id, me.master_owner_id, me.market, me.property_address
      into v_property_id, v_owner_id, v_market, v_property_address
      from public.message_events me
      where me.prospect_id = v_prospect_id
      order by me.event_timestamp desc
      limit 1;
    elsif v_thread_key like 'property:%' then
      v_property_id := substring(v_thread_key from 11);
      select me.master_owner_id, me.prospect_id, me.market, me.property_address
      into v_owner_id, v_prospect_id, v_market, v_property_address
      from public.message_events me
      where me.property_id = v_property_id
      order by me.event_timestamp desc
      limit 1;
    else
      -- event:xxx or unknown format - look up by ID
      select me.property_id, me.master_owner_id, me.prospect_id, me.market, me.property_address
      into v_property_id, v_owner_id, v_prospect_id, v_market, v_property_address
      from public.message_events me
      where me.id::text = substring(v_thread_key from 7)
      limit 1;
    end if;

    -- Return enrichment row
    thread_key := v_thread_key;
    property_id := v_property_id;
    master_owner_id := v_owner_id;
    prospect_id := v_prospect_id;

    -- Fetch property data
    if v_property_id is not null and v_property_id != '' then
      select
        p.full_address,
        p.street,
        p.city,
        p.state,
        p.zip,
        p.property_type,
        p.bedrooms,
        p.bathrooms,
        p.living_area_sqft,
        p.year_built,
        p.effective_year_built,
        p.estimated_value,
        p.cash_offer,
        p.equity_amount,
        p.equity_percent,
        p.estimated_repair_cost,
        p.streetview_image,
        p.zillow_url,
        p.realtor_url
      into
        property_address_full,
        property_street,
        property_city,
        property_state,
        property_zip,
        property_type,
        beds,
        baths,
        sqft,
        year_built,
        effective_year_built,
        estimated_value,
        cash_offer,
        equity_amount,
        equity_percent,
        estimated_repair_cost,
        streetview_image,
        zillow_url,
        realtor_url
      from public.properties p
      where p.property_id::text = v_property_id;
    end if;

    -- Fall back to message_event address if property table doesn't have it
    if property_address_full is null and v_property_address is not null then
      property_address_full := v_property_address;
    end if;

    -- Fall back to market from message_event
    if market_name is null and v_market is not null then
      market_name := v_market;
    end if;

    -- Fetch owner data
    if v_owner_id is not null and v_owner_id != '' then
      select
        o.display_name,
        o.first_name,
        o.last_name,
        o.owner_type,
        o.best_phone,
        o.phone_confidence,
        o.contact_language,
        o.is_owner_occupied,
        o.is_absentee,
        o.is_vacant,
        o.has_lien,
        o.is_probate,
        o.is_tax_delinquent
      into
        owner_display_name,
        seller_first_name,
        seller_last_name,
        owner_type,
        best_phone,
        phone_confidence,
        contact_language,
        is_owner_occupied,
        is_absentee,
        is_vacant,
        has_lien,
        is_probate,
        is_tax_delinquent
      from public.owners o
      where o.owner_id::text = v_owner_id;
    end if;

    -- Return the row
    return next;
  end loop;
end;
$$;

-- Grant execute to anon and authenticated roles
grant execute on function public.get_thread_enrichment(text[]) to anon, authenticated;
