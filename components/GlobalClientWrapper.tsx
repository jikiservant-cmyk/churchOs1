import SplashScreen from "./SplashScreen";
import SWRegistration from "./SWRegistration";
import { ClientOnlyComponents } from "./ClientOnlyComponents";

export default function GlobalClientWrapper({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ClientOnlyComponents />
      {children}
    </>
  );
}
