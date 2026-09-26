-- Fix security issue: Replace public SELECT policy with user-specific policy
DROP POLICY IF EXISTS "Anyone can view generated signals" ON public.generated_signals;

-- Create new policy that restricts users to only view their own signals
CREATE POLICY "Users can view their own signals"
ON public.generated_signals
FOR SELECT
USING (auth.uid() = user_id);

-- Also tighten the INSERT policy to require user_id matching auth.uid()
DROP POLICY IF EXISTS "Authenticated users can create signals" ON public.generated_signals;

CREATE POLICY "Users can create their own signals"
ON public.generated_signals
FOR INSERT
WITH CHECK (auth.uid() = user_id);