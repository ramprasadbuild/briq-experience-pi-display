// Root of the TV kiosk app. Subscribes to the box (box.js), folds presenter frames into the view
// state (kioskState.js), and shows the idle screen, the idle loop (the box's own images and videos,
// screens/Signage.jsx) or the presented project's chapter.
// Screens are display-only: every change comes from the tablet through the relay.
import { useEffect, useMemo, useReducer, useState } from 'react';
import { useDevice, useProject, useRelayFrames, useSignage } from './box.js';
import { buildChapters } from './chapters.js';
import { hostBridge, toHost } from './host.js';
import { initialView, viewReducer } from './kioskState.js';
import Brochure from './screens/Brochure.jsx';
import Home from './screens/Home.jsx';
import Idle from './screens/Idle.jsx';
import Inventory from './screens/Inventory.jsx';
import Location from './screens/Location.jsx';
import MasterPlan from './screens/MasterPlan.jsx';
import Renders from './screens/Renders.jsx';
import Signage from './screens/Signage.jsx';
import VR from './screens/VR.jsx';
import Walkthrough from './screens/Walkthrough.jsx';
import { Empty, Loading } from './ui/Chrome.jsx';

const SCREENS = { home: Home, renders: Renders, inventory: Inventory, brochure: Brochure, vr: VR, walkthrough: Walkthrough, location: Location, masterplan: MasterPlan };

/** How long the idle screen (name, network, what's on the TV) shows before the idle loop takes over. */
const IDLE_LOOP_AFTER_MS = 30_000;

/** True once the TV has been idle (nothing presented) for IDLE_LOOP_AFTER_MS; false again the moment something is presented. */
function useIdleFor(idle, ms) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!idle) { setElapsed(false); return undefined; }
    const t = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(t);
  }, [idle, ms]);
  return idle && elapsed;
}

/** The presented project: one chapter screen at a time, remounted (`key`) when the chapter changes. */
function Kiosk({ data, kiosk, status }) {
  const chapters = useMemo(() => buildChapters(data), [data]);
  const chapter = SCREENS[kiosk.chapter] ? kiosk.chapter : 'home';
  const Screen = SCREENS[chapter];
  const meta = chapters.find((c) => c.id === chapter) ?? null;
  return (
    <div className="kiosk" key={chapter}>
      <Screen data={data} s={kiosk[chapter] ?? {}} kiosk={kiosk} chapters={chapters} meta={meta} status={status} />
    </div>
  );
}

export default function App() {
  const { status, identify, contentTick, connected } = useDevice();
  const [view, dispatch] = useReducer(viewReducer, initialView);
  useRelayFrames(dispatch);
  const signage = useSignage();
  // Host bridge: the subscriptions above are in place; ask for status and the last command/state.
  useEffect(() => { if (hostBridge) toHost({ t: 'ready' }); }, []);
  const project = useProject(view.mode === 'present' ? view.slug : null, contentTick);

  // The idle loop: a paired TV with screen content plays it whenever nothing is presented. An
  // unpaired TV keeps showing its pairing code.
  const idleLong = useIdleFor(view.mode !== 'present', IDLE_LOOP_AFTER_MS);

  let body;
  if (view.mode !== 'present') {
    body = idleLong && status?.claimed && signage.items.length
      ? <Signage signage={signage} />
      : <Idle status={status} connected={connected} />;
  } else if (project.state === 'ready') {
    body = <Kiosk data={project.data} kiosk={view.kiosk} status={status} />;
  } else if (project.state === 'missing') {
    body = (
      <Empty title="Not on this TV yet">
        “{view.slug}” hasn’t been downloaded to this TV. Assign the project to this TV in the CRM; it will be ready after the next sync.
      </Empty>
    );
  } else if (project.state === 'error') {
    body = <Empty title="Couldn’t open this project">{project.error}</Empty>;
  } else {
    body = <Loading label="Opening experience" />;
  }

  return (
    <div className="app">
      {body}
      {identify ? (
        <div className="identify">
          <div className="identify-card">
            <div className="kicker">THIS TV</div>
            <div className="identify-name">{identify.name || 'Unnamed TV'}</div>
            <div className="identify-id">Device {identify.device_id}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
