import { Signup } from '@/features/auth/signup';

/** Forgotten PIN: phone, the texted code, then a new PIN. */
export default function ForgotPin() {
  return <Signup reset />;
}
