// App-wide WebSocket singleton. Lives in its own module so route components and tests can import
// the same instance the layout subscribes with (tests mock the WsManager class itself).
import { WsManager } from "./ws-manager";
import { WS_URL } from "../lib/constants";

export const wsManager = new WsManager(WS_URL);
