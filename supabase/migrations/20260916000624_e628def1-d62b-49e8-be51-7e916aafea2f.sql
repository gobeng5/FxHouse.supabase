CREATE OR REPLACE FUNCTION public.arbitrate_signal(
  p_user_id uuid,
  p_instrument text,
  p_direction text,
  p_trade_type text,
  p_confidence integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reversal_edge constant integer := 5;
  v_same_dir record;
  v_strongest_opp record;
  v_cancel_ids uuid[] := ARRAY[]::uuid[];
  v_conflict record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorised to arbitrate for another user';
  END IF;

  IF p_direction = 'ranging' OR p_direction IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Direction is ranging — no setup to arbitrate.', 'code', 'ranging', 'cancel_ids', '[]'::jsonb);
  END IF;

  SELECT id, direction, trade_type, confidence INTO v_same_dir
  FROM generated_signals
  WHERE user_id = p_user_id AND outcome = 'pending'
    AND instrument = p_instrument AND direction = p_direction
  ORDER BY (trade_type = p_trade_type) DESC, confidence DESC
  LIMIT 1;

  IF v_same_dir.id IS NOT NULL THEN
    IF v_same_dir.trade_type = p_trade_type THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', format('A pending %s %s setup already exists on %s.', p_direction, p_trade_type, p_instrument),
        'code', 'duplicate_direction', 'cancel_ids', '[]'::jsonb);
    ELSE
      RETURN jsonb_build_object('allowed', false,
        'reason', format('%s already has an active %s %s setup — one setup per pair.', p_instrument, v_same_dir.direction, v_same_dir.trade_type),
        'code', 'pair_slot_taken', 'cancel_ids', '[]'::jsonb);
    END IF;
  END IF;

  SELECT id, direction, confidence INTO v_strongest_opp
  FROM generated_signals
  WHERE user_id = p_user_id AND outcome = 'pending'
    AND instrument = p_instrument AND direction <> p_direction AND direction <> 'ranging'
  ORDER BY confidence DESC
  LIMIT 1;

  IF v_strongest_opp.id IS NOT NULL THEN
    IF p_confidence < v_strongest_opp.confidence + v_reversal_edge THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', format('Conflicts with a pending %s setup on %s (%s%% vs %s%%) — blocked.', v_strongest_opp.direction, p_instrument, v_strongest_opp.confidence, p_confidence),
        'code', 'weaker_reversal', 'cancel_ids', '[]'::jsonb);
    END IF;

    SELECT array_agg(id) INTO v_cancel_ids
    FROM generated_signals
    WHERE user_id = p_user_id AND outcome = 'pending'
      AND instrument = p_instrument AND direction <> 'ranging';
  END IF;

  SELECT cp.pair_1, cp.pair_2, cp.correlation, gs.direction AS other_direction, gs.confidence AS other_confidence
    INTO v_conflict
  FROM correlation_pairs cp
  JOIN generated_signals gs
    ON gs.user_id = p_user_id
   AND gs.outcome = 'pending'
   AND gs.direction <> 'ranging'
   AND gs.instrument <> p_instrument
   AND NOT (gs.id = ANY (COALESCE(v_cancel_ids, ARRAY[]::uuid[])))
   AND gs.instrument = CASE WHEN cp.pair_1 = p_instrument THEN cp.pair_2 ELSE cp.pair_1 END
  WHERE (cp.pair_1 = p_instrument OR cp.pair_2 = p_instrument)
    AND (
      (cp.correlation = 'positive' AND gs.direction <> p_direction)
      OR (cp.correlation = 'negative' AND gs.direction = p_direction)
    )
    AND ((gs.confidence + p_confidence) / 2.0) >= 70
  ORDER BY gs.confidence DESC
  LIMIT 1;

  IF v_conflict.correlation IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', format('Correlation conflict: %s is %s and %s is %s — %s correlated instruments.',
        p_instrument, p_direction,
        CASE WHEN v_conflict.pair_1 = p_instrument THEN v_conflict.pair_2 ELSE v_conflict.pair_1 END,
        v_conflict.other_direction, v_conflict.correlation),
      'code', 'correlation_conflict', 'cancel_ids', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', CASE WHEN array_length(v_cancel_ids,1) > 0
      THEN format('Reversal confirmed (%s%%) — replacing existing %s setup.', p_confidence, p_instrument)
      ELSE 'No conflicts — setup approved.' END,
    'code', 'approved',
    'cancel_ids', COALESCE(to_jsonb(v_cancel_ids), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.arbitrate_signal(uuid, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.arbitrate_signal(uuid, text, text, text, integer) TO authenticated, service_role;