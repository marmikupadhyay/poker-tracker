import React, { useState, useMemo, useRef, useEffect } from 'react';
import { collection, doc, setDoc, onSnapshot, query, where } from 'firebase/firestore';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut } from "firebase/auth";
import { db, auth } from './firebase';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const NUM_SEATS = 9;
const STREETS = ['PRE-FLOP', 'FLOP', 'TURN', 'RIVER'];

const DEFAULT_TAGS = [
  { emoji: '🐟', desc: 'Fish (Loose Passive)' },
  { emoji: '🦈', desc: 'Shark (Solid Winner)' },
  { emoji: '💣', desc: 'Maniac (Aggressive)' },
  { emoji: '🪨', desc: 'Rock (Tight Passive)' },
  { emoji: '🤠', desc: 'Pro / Regular' },
  { emoji: '🤡', desc: 'Donkey (Reckless)' },
  { emoji: '🤑', desc: 'Whale (Rich/Loose)' },
  { emoji: '🦁', desc: 'LAG (Loose Aggressive)' }
];

const getPositionName = (seatIdx, dealerIdx) => {
  const offset = (seatIdx - dealerIdx + NUM_SEATS) % NUM_SEATS;
  if (offset === 1 || offset === 2) return 'Blinds';
  if (offset === 0 || offset === 8) return 'Late';
  if (offset >= 3 && offset <= 4) return 'Early';
  return 'Middle';
};

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [users, setUsers] = useState([]); 
  const [currentSessionId, setCurrentSessionId] = useState(null);
  
  // Auth state
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');
  const [customTags, setCustomTags] = useState(DEFAULT_TAGS);
  
  // 'session', 'history', 'users'
  const [viewMode, setViewMode] = useState('session');
  
  const [sbAmount, setSbAmount] = useState(1);
  const [bbAmount, setBbAmount] = useState(2);
  const [sessionLocation, setSessionLocation] = useState('Home Game');
  const [sessionGameType, setSessionGameType] = useState('NLH');
  
  const [modalSeatIdx, setModalSeatIdx] = useState(null);
  const [updateStackVal, setUpdateStackVal] = useState('');
  
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [selectedUserForModal, setSelectedUserForModal] = useState(null);
  const [selectedHistorySessionId, setSelectedHistorySessionId] = useState(null);
  const [selectedBankrollUserId, setSelectedBankrollUserId] = useState('');

  const [heroSeat, setHeroSeat] = useState(0);
  const [heroBuyIn, setHeroBuyIn] = useState(200);
  const [heroUserId, setHeroUserId] = useState('none');

  const fileHandleRef = useRef(null);

  const currentSession = useMemo(() => sessions.find(s => s.id === currentSessionId), [sessions, currentSessionId]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setSessions([]);
      setUsers([]);
      setCustomTags(DEFAULT_TAGS);
      return;
    }
    
    const unsubSettings = onSnapshot(doc(db, 'userSettings', currentUser.uid), (docSnap) => {
      if (docSnap.exists() && docSnap.data().tags) {
        setCustomTags(docSnap.data().tags);
      } else {
        setCustomTags(DEFAULT_TAGS);
      }
    });

    const unsubSessions = onSnapshot(query(collection(db, 'sessions'), where('ownerId', '==', currentUser.uid)), (snapshot) => {
      const fetched = snapshot.docs.map(d => d.data());
      setSessions(fetched);
    });
    const unsubUsers = onSnapshot(query(collection(db, 'users'), where('ownerId', '==', currentUser.uid)), (snapshot) => {
      const fetched = snapshot.docs.map(d => d.data());
      setUsers(fetched);
    });
    return () => { unsubSessions(); unsubUsers(); unsubSettings(); };
  }, [currentUser]);

  const updateSession = (updater) => {
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        const updated = updater(s);
        setDoc(doc(db, 'sessions', updated.id.toString()), updated).catch(console.error);
        return updated;
      }
      return s;
    }));
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (authMode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        const newUser = { id: cred.user.uid, ownerId: cred.user.uid, name: authName || authEmail.split('@')[0], tags: [], notes: '' };
        await setDoc(doc(db, 'users', cred.user.uid), newUser);
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await setDoc(doc(db, 'users', cred.user.uid), { 
        id: cred.user.uid, 
        ownerId: cred.user.uid,
        name: cred.user.displayName || cred.user.email.split('@')[0]
      }, { merge: true });
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const createAnonymousPlayer = (idx) => ({
    userId: `anon_${Date.now()}_${idx}`,
    name: `S${idx+1}`,
    stack: 0,
    rebuys: 0,
    stackHistory: [{ time: new Date().toISOString(), stack: 0, label: 'Join' }]
  });

  const startSession = () => {
    const players = Array.from({ length: NUM_SEATS }, (_, i) => createAnonymousPlayer(i));
    
    if (heroUserId !== 'none') {
      const u = users.find(x => x.id === heroUserId);
      if (u) {
        players[heroSeat] = {
          userId: u.id,
          name: u.name,
          stack: heroBuyIn,
          rebuys: heroBuyIn,
          stackHistory: [{ time: new Date().toISOString(), stack: heroBuyIn, label: 'Join' }]
        };
      }
    }

    const newSession = {
      id: Date.now(),
      ownerId: currentUser.uid,
      startTime: new Date().toISOString(),
      endTime: null,
      location: sessionLocation,
      gameType: sessionGameType,
      sbAmount,
      bbAmount,
      dealerButtonSeat: 0,
      activeTurnSeat: 3,
      highestAction: 'none',
      aggressorSeat: null,
      currentStreet: 0,
      actionsThisStreet: 0,
      initialActivePlayersThisStreet: NUM_SEATS,
      foldedSeats: [],
      hands: [],
      currentHandActions: [],
      pendingShowdown: false,
      players
    };
    
    // Auto-post blinds
    const sbSeat = 1 % NUM_SEATS;
    const bbSeat = 2 % NUM_SEATS;
    newSession.players[sbSeat].stack -= sbAmount;
    newSession.players[sbSeat].stackHistory.push({ time: new Date().toISOString(), stack: newSession.players[sbSeat].stack, label: 'Post SB' });
    newSession.players[bbSeat].stack -= bbAmount;
    newSession.players[bbSeat].stackHistory.push({ time: new Date().toISOString(), stack: newSession.players[bbSeat].stack, label: 'Post BB' });
    newSession.aggressorSeat = bbSeat;

    setDoc(doc(db, 'sessions', newSession.id.toString()), newSession).catch(console.error);
    setSessions(prev => {
      // Check if it already exists to prevent duplicate local state if onSnapshot fired first
      if (prev.find(s => s.id === newSession.id)) return prev;
      return [...prev, newSession];
    });
    setCurrentSessionId(newSession.id);
    setViewMode('session');
  };

  const endSession = () => {
    if (!currentSessionId) return;
    updateSession(s => ({ ...s, endTime: new Date().toISOString() }));
    setCurrentSessionId(null);
    setViewMode('history');
  };

  const getNextActiveSeat = (startSeat, foldedSeats) => {
    let nextSeat = (startSeat + 1) % NUM_SEATS;
    let checks = 0;
    while (foldedSeats.includes(nextSeat) && checks < NUM_SEATS) {
      nextSeat = (nextSeat + 1) % NUM_SEATS;
      checks++;
    }
    return nextSeat;
  };

  const initHand = (s) => {
    const sbSeat = (s.dealerButtonSeat + 1) % NUM_SEATS;
    const bbSeat = (s.dealerButtonSeat + 2) % NUM_SEATS;
    
    const players = [...s.players];
    players[sbSeat] = { ...players[sbSeat], stack: players[sbSeat].stack - s.sbAmount, stackHistory: [...players[sbSeat].stackHistory, { time: new Date().toISOString(), stack: players[sbSeat].stack - s.sbAmount, label: 'Post SB' }] };
    players[bbSeat] = { ...players[bbSeat], stack: players[bbSeat].stack - s.bbAmount, stackHistory: [...players[bbSeat].stackHistory, { time: new Date().toISOString(), stack: players[bbSeat].stack - s.bbAmount, label: 'Post BB' }] };
    
    return {
      ...s,
      players,
      highestAction: 'none',
      aggressorSeat: bbSeat,
      currentStreet: 0,
      actionsThisStreet: 0,
      foldedSeats: [],
      initialActivePlayersThisStreet: NUM_SEATS,
      activeTurnSeat: (s.dealerButtonSeat + 3) % NUM_SEATS,
      currentHandActions: [],
      pendingShowdown: false
    };
  };

  const commitHand = (winnerId, wentToShowdown) => {
    updateSession(s => {
      const completedHand = {
        actions: s.currentHandActions,
        winnerId,
        wentToShowdown
      };
      const nextS = {
        ...s,
        hands: [...s.hands, completedHand],
        dealerButtonSeat: (s.dealerButtonSeat + 1) % NUM_SEATS
      };
      return initHand(nextS);
    });
  };

  const forceAdvanceStreet = () => {
    updateSession(s => {
      if (s.currentStreet >= 3) {
        return { ...s, pendingShowdown: true };
      }
      return {
        ...s,
        currentStreet: s.currentStreet + 1,
        highestAction: 'none',
        aggressorSeat: null,
        actionsThisStreet: 0,
        initialActivePlayersThisStreet: NUM_SEATS - s.foldedSeats.length,
        activeTurnSeat: getNextActiveSeat(s.dealerButtonSeat, s.foldedSeats)
      };
    });
  };

  const recordAction = (action) => {
    updateSession(s => {
      const currentSeat = s.activeTurnSeat;
      const activePlayer = s.players[currentSeat];
      
      const newAction = {
        seat: currentSeat,
        playerId: activePlayer.userId,
        action,
        facing: s.highestAction,
        street: s.currentStreet,
        time: new Date().toISOString()
      };
      
      let nextS = {
        ...s,
        currentHandActions: [...s.currentHandActions, newAction],
        actionsThisStreet: s.actionsThisStreet + 1
      };
      
      if (action === 'fold') {
        nextS.foldedSeats = [...nextS.foldedSeats, currentSeat];
      }
      
      if (['raise', '3bet', '4bet'].includes(action)) {
        nextS.highestAction = action;
        nextS.aggressorSeat = currentSeat;
      }
      
      nextS.activeTurnSeat = getNextActiveSeat(currentSeat, nextS.foldedSeats);
      
      // Early win check
      if (nextS.foldedSeats.length >= NUM_SEATS - 1) {
        const winnerSeat = [...Array(NUM_SEATS).keys()].find(i => !nextS.foldedSeats.includes(i));
        const winnerId = nextS.players[winnerSeat].userId;
        const completedHand = { actions: nextS.currentHandActions, winnerId, wentToShowdown: false };
        return initHand({
          ...nextS,
          hands: [...nextS.hands, completedHand],
          dealerButtonSeat: (nextS.dealerButtonSeat + 1) % NUM_SEATS
        });
      }
      
      let shouldAdvance = false;
      const bbSeat = (nextS.dealerButtonSeat + 2) % NUM_SEATS;
      
      if (['raise', '3bet', '4bet'].includes(action)) {
        shouldAdvance = false;
      } else if (nextS.highestAction !== 'none') {
        if (nextS.activeTurnSeat === nextS.aggressorSeat) shouldAdvance = true;
      } else {
        if (nextS.actionsThisStreet >= nextS.initialActivePlayersThisStreet) shouldAdvance = true;
      }
      
      if (shouldAdvance) {
        if (nextS.currentStreet < 3) {
          nextS.currentStreet++;
          nextS.highestAction = 'none';
          nextS.aggressorSeat = null;
          nextS.actionsThisStreet = 0;
          nextS.initialActivePlayersThisStreet = NUM_SEATS - nextS.foldedSeats.length;
          nextS.activeTurnSeat = getNextActiveSeat(nextS.dealerButtonSeat, nextS.foldedSeats);
        } else {
          nextS.pendingShowdown = true;
        }
      }
      
      return nextS;
    });
  };

  // -- File System Removed --
  // (Data is now synced automatically with Firebase)

  // -- User/Player Management --

  const handleCreateUser = () => {
    const name = prompt("Enter new user name:");
    if (!name) return;
    const newUser = { id: `u_${Date.now()}`, ownerId: currentUser.uid, name, tags: [], notes: '' };
    setDoc(doc(db, 'users', newUser.id), newUser).catch(console.error);
    setUsers(prev => {
      if (prev.find(u => u.id === newUser.id)) return prev;
      return [...prev, newUser];
    });
    return newUser;
  };

  const updateGlobalUser = (userId, updates) => {
    setUsers(prev => prev.map(u => {
      if (u.id === userId) {
        const updated = { ...u, ...updates };
        setDoc(doc(db, 'users', updated.id), updated).catch(console.error);
        return updated;
      }
      return u;
    }));
  };

  const assignUserToSeat = (seatIdx, userId) => {
    if (!currentSession) return;
    let selectedUser;
    
    if (userId === 'NEW') {
      selectedUser = handleCreateUser();
      if (!selectedUser) return;
    } else {
      selectedUser = users.find(u => u.id === userId);
    }

    if (selectedUser) {
      updateSession(s => {
        const p = [...s.players];
        p[seatIdx] = { ...p[seatIdx], userId: selectedUser.id, name: selectedUser.name };
        return { ...s, players: p };
      });
    }
  };

  // -- Stats Calculation --

  const calculateLifetimeStats = (userId, targetSessions = sessions) => {
    let vpipCount = 0, pfrCount = 0, threeBetCount = 0, f3betOpp = 0, f3betFold = 0;
    let preflopHandsPlayed = 0;
    let wins = 0, showdownWins = 0, totalHandsInvolved = 0;
    
    // Advanced Post-Flop Stats
    let cbetOpp = 0, cbetCount = 0;
    let foldToCbetOpp = 0, foldToCbetCount = 0;
    let afBetsRaises = 0, afCalls = 0;
    let sawFlopCount = 0, wtsdCount = 0;
    
    // Financial Stats
    let netProfit = 0;
    let totalHours = 0;

    // Positional Stats
    let posHands = { Blinds: 0, Early: 0, Middle: 0, Late: 0 };
    let posVpip = { Blinds: 0, Early: 0, Middle: 0, Late: 0 };
    let posPfr = { Blinds: 0, Early: 0, Middle: 0, Late: 0 };
    
    targetSessions.forEach(s => {
      const playerInSession = s.players.find(p => p.userId === userId);
      if (playerInSession) {
        netProfit += (playerInSession.stack - playerInSession.rebuys);
        const start = new Date(s.startTime);
        const end = s.endTime ? new Date(s.endTime) : new Date();
        totalHours += (end - start) / (1000 * 60 * 60);
      }

      const allHands = [...s.hands];
      if (s.currentHandActions && s.currentHandActions.length > 0) {
        allHands.push({ actions: s.currentHandActions, winnerId: null, wentToShowdown: false, dealerSeat: s.dealerButtonSeat });
      }

      allHands.forEach((hand, hIdx) => {
        const dealerIdx = hand.dealerSeat !== undefined ? hand.dealerSeat : (0 + hIdx) % NUM_SEATS;
        const playerActions = hand.actions.filter(a => a.playerId === userId);
        
        if (playerActions.length > 0) {
          totalHandsInvolved++;
          
          if (hand.winnerId === userId) {
            wins++;
            if (hand.wentToShowdown) showdownWins++;
          }

          // AF Calculation
          playerActions.forEach(a => {
            if (['raise', '3bet', '4bet'].includes(a.action)) afBetsRaises++;
            if (a.action === 'call') afCalls++;
          });

          // Did player see flop?
          const sawFlop = playerActions.some(a => a.street >= 1) || hand.wentToShowdown;
          if (sawFlop) sawFlopCount++;
          if (sawFlop && hand.wentToShowdown) wtsdCount++;

          const preflopActions = playerActions.filter(a => a.street === 0);
          if (preflopActions.length > 0) {
            preflopHandsPlayed++;
            
            const firstActionSeat = preflopActions[0].seat;
            const pos = getPositionName(firstActionSeat, dealerIdx);
            posHands[pos]++;
            
            const vpip = preflopActions.some(a => ['call', 'raise', '3bet', '4bet'].includes(a.action));
            const pfr = preflopActions.some(a => ['raise', '3bet', '4bet'].includes(a.action));
            const threeBet = preflopActions.some(a => a.action === '3bet');
            const faced3bFold = preflopActions.some(a => a.action === 'fold' && a.facing === '3bet');
            const faced3bCall = preflopActions.some(a => ['call','4bet'].includes(a.action) && a.facing === '3bet');
            
            if (vpip) { vpipCount++; posVpip[pos]++; }
            if (pfr) { pfrCount++; posPfr[pos]++; }
            if (threeBet) threeBetCount++;
            if (faced3bFold || faced3bCall) f3betOpp++;
            if (faced3bFold) f3betFold++;

            // C-Bet Logic
            const flopActions = playerActions.filter(a => a.street === 1);
            if (pfr && flopActions.length > 0) {
              cbetOpp++;
              if (flopActions.some(a => ['raise'].includes(a.action))) cbetCount++;
            }

            // Fold to C-Bet Logic
            if (vpip && !pfr && flopActions.length > 0) {
              const facedBetOnFlop = flopActions.some(a => a.facing === 'raise');
              if (facedBetOnFlop) {
                foldToCbetOpp++;
                if (flopActions.some(a => a.action === 'fold' && a.facing === 'raise')) foldToCbetCount++;
              }
            }
          }
        }
      });
    });

    const calcPos = (val, opp) => opp ? Math.round((val / opp) * 100) : 0;

    return {
      totalHandsInvolved,
      wins,
      showdownWins,
      vpip: preflopHandsPlayed ? Math.round((vpipCount / preflopHandsPlayed) * 100) : 0,
      pfr: preflopHandsPlayed ? Math.round((pfrCount / preflopHandsPlayed) * 100) : 0,
      threeBet: preflopHandsPlayed ? Math.round((threeBetCount / preflopHandsPlayed) * 100) : 0,
      foldTo3Bet: f3betOpp ? Math.round((f3betFold / f3betOpp) * 100) : 0,
      winRate: totalHandsInvolved ? Math.round((wins / totalHandsInvolved) * 100) : 0,
      
      af: afCalls === 0 ? (afBetsRaises > 0 ? 'Inf' : 0) : (afBetsRaises / afCalls).toFixed(1),
      wtsd: sawFlopCount ? Math.round((wtsdCount / sawFlopCount) * 100) : 0,
      cbet: cbetOpp ? Math.round((cbetCount / cbetOpp) * 100) : 0,
      foldToCbet: foldToCbetOpp ? Math.round((foldToCbetCount / foldToCbetOpp) * 100) : 0,
      
      netProfit,
      hourlyRate: totalHours > 0 ? Math.round(netProfit / totalHours) : 0,
      totalHours: totalHours.toFixed(1),

      posVpip: {
        Early: calcPos(posVpip.Early, posHands.Early),
        Middle: calcPos(posVpip.Middle, posHands.Middle),
        Late: calcPos(posVpip.Late, posHands.Late),
        Blinds: calcPos(posVpip.Blinds, posHands.Blinds)
      },
      posPfr: {
        Early: calcPos(posPfr.Early, posHands.Early),
        Middle: calcPos(posPfr.Middle, posHands.Middle),
        Late: calcPos(posPfr.Late, posHands.Late),
        Blinds: calcPos(posPfr.Blinds, posHands.Blinds)
      }
    };
  };

  const getActionButtons = () => {
    if (!currentSession) return [];
    
    const isPreFlop = currentSession.currentStreet === 0;
    const bbSeat = (currentSession.dealerButtonSeat + 2) % NUM_SEATS;
    const isBB = currentSession.activeTurnSeat === bbSeat;
    
    let btns = [{ action: 'fold', label: 'Fold' }];
    
    if (currentSession.highestAction === 'none') {
      if (isPreFlop && isBB) {
        btns.push({ action: 'check', label: 'Check' });
        btns.push({ action: 'raise', label: 'Raise' });
      } else if (!isPreFlop) {
        btns.push({ action: 'check', label: 'Check' });
        btns.push({ action: 'raise', label: 'Bet' });
      } else {
        btns.push({ action: 'call', label: 'Call' });
        btns.push({ action: 'raise', label: 'Raise' });
      }
    } else if (currentSession.highestAction === 'raise') {
      btns.push({ action: 'call', label: 'Call' });
      btns.push({ action: '3bet', label: '3-Bet' });
    } else if (currentSession.highestAction === '3bet') {
      btns.push({ action: 'call', label: 'Call' });
      btns.push({ action: '4bet', label: '4-Bet' });
    } else if (currentSession.highestAction === '4bet') {
      btns.push({ action: 'call', label: 'Call' });
    }
    return btns;
  };

  // -- Render Helpers --

  const renderSessionDetails = (sessionId) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return <p>Session not found</p>;

    // Graph Data calculation
    let allTimes = new Set();
    session.players.forEach(p => {
      p.stackHistory.forEach(h => allTimes.add(h.time));
    });
    
    let timesArray = Array.from(allTimes).sort();
    let labels = timesArray.map((t, i) => `Hand/Action ${i+1}`);
    
    const colors = ['#38bdf8','#f59e0b','#10b981','#ef4444','#a855f7','#ec4899','#f97316','#06b6d4','#84cc16'];
    
    let datasets = session.players.map((p, idx) => {
      let currentStack = 0;
      let data = timesArray.map(t => {
        let historyAtT = p.stackHistory.find(h => h.time === t);
        if (historyAtT) currentStack = historyAtT.stack;
        return currentStack;
      });
      return {
        label: p.name,
        data: data,
        borderColor: colors[idx % colors.length],
        borderWidth: 2,
        fill: false,
        tension: 0.1
      };
    });
    
    const chartData = { labels, datasets };
    const chartOptions = {
      responsive: true,
      plugins: { legend: { display: true, position: 'bottom', labels: { color: '#f8fafc' } } },
      scales: {
        y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
        x: { grid: { color: '#334155', display: false } }
      }
    };

    return (
      <div className="session-details">
        <button className="btn secondary mb-2" onClick={() => setSelectedHistorySessionId(null)}>← Back to History</button>
        <h2 style={{color: 'var(--accent)', marginBottom: '1rem'}}>Session Report</h2>
        
        <div className="chart-container" style={{backgroundColor: 'var(--bg-dark)', padding: '1rem', borderRadius: '12px', marginBottom: '2rem'}}>
           <Line data={chartData} options={chartOptions} />
        </div>

        <h3>Session Leaderboard (Wins)</h3>
        <div className="leaderboard-list mt-1" style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
          {session.players.map(p => {
            const stats = calculateLifetimeStats(p.userId, [session]);
            return (
              <div key={p.userId} className="panel" style={{display: 'flex', justifyContent: 'space-between', padding: '1rem', margin: 0}}>
                <div style={{fontWeight: 'bold', fontSize: '1.1rem'}}>{p.name}</div>
                <div style={{color: 'var(--success)'}}>{stats.wins} Wins</div>
              </div>
            );
          }).sort((a,b) => parseInt(b.props.children[1].props.children[0]) - parseInt(a.props.children[1].props.children[0]))}
        </div>
      </div>
    );
  };

  const renderSessionHistory = () => {
    if (selectedHistorySessionId) return renderSessionDetails(selectedHistorySessionId);

    if (sessions.length === 0) return <p className="panel">No past sessions found.</p>;
    const sorted = [...sessions].sort((a,b) => b.id - a.id);
    
    return (
      <div className="session-list" style={{display: 'flex', flexDirection: 'column', gap: '0.8rem'}}>
        {sorted.map((s, idx) => {
          const winsMap = {};
          s.hands.forEach(h => {
            if(h.winnerId) winsMap[h.winnerId] = (winsMap[h.winnerId] || 0) + 1;
          });
          const topWinnerId = Object.keys(winsMap).sort((a,b) => winsMap[b] - winsMap[a])[0];
          const topWinner = s.players.find(p => p.userId === topWinnerId);

          return (
            <div key={s.id} className="session-item panel hover-effect" onClick={() => setSelectedHistorySessionId(s.id)} style={{cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 0}}>
              <div>
                <div className="session-date" style={{fontWeight: 'bold', fontSize: '1.2rem'}}>Session {sessions.length - idx}</div>
                <div style={{fontSize: '0.9rem', color: 'var(--text-muted)'}}>{new Date(s.startTime).toLocaleDateString()} • {s.hands.length} hands</div>
              </div>
              {topWinner && (
                <div style={{textAlign: 'right'}}>
                  <div style={{color: 'var(--success)'}}>🥇 {topWinner.name}</div>
                  <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>{winsMap[topWinnerId]} pots</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderAllUsers = () => {
    if (selectedUserForModal) {
      const u = users.find(x => x.id === selectedUserForModal);
      if (!u) return null;
      const stats = calculateLifetimeStats(u.id);
      return (
        <div className="user-profile-page">
          <button className="btn secondary mb-2" onClick={() => setSelectedUserForModal(null)}>← Back to Players</button>
          
          <div className="panel mb-2" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem'}}>
            <h2 style={{color: 'var(--accent)', fontSize: '1.8rem', margin: 0}}>
              {u.name} <span style={{fontSize: '1.2rem'}}>{u.tags?.join(' ')}</span>
            </h2>
          </div>

          <div className="form-section">
            <h3>Quick Tags</h3>
            <div style={{display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap'}}>
              {customTags.map(tag => {
                const isActive = u.tags?.includes(tag.emoji);
                return (
                  <button 
                    key={tag.emoji} 
                    title={tag.desc}
                    onClick={() => {
                      const tags = u.tags || [];
                      updateGlobalUser(u.id, { tags: isActive ? tags.filter(t => t !== tag.emoji) : [...tags, tag.emoji] });
                    }} 
                    className="btn action-btn" 
                    style={{
                      padding: '0.5rem', 
                      fontSize: '1rem', 
                      opacity: isActive ? 1 : 0.4,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.2rem',
                      minWidth: '60px'
                    }}
                  >
                    <div style={{fontSize: '1.4rem'}}>{tag.emoji}</div>
                    <div style={{fontSize: '0.65rem', color: isActive ? 'white' : 'var(--text-muted)', textAlign: 'center', lineHeight: '1.1'}}>{tag.desc}</div>
                  </button>
                );
              })}
            </div>
            
            <div className="mb-2" style={{borderTop: '1px solid var(--border)', paddingTop: '1rem'}}>
              <div className="input-label" style={{marginBottom: '0.5rem'}}>Add Custom Tag</div>
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <input type="text" id="newEmoji" placeholder="Emoji (e.g. 🦊)" style={{width: '80px', padding: '0.5rem', background: 'var(--bg-dark)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px'}} />
                <input type="text" id="newDesc" placeholder="Description (e.g. Tricky)" style={{flex: 1, padding: '0.5rem', background: 'var(--bg-dark)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px'}} />
                <button className="btn primary" onClick={() => {
                  const emoji = document.getElementById('newEmoji').value;
                  const desc = document.getElementById('newDesc').value;
                  if (emoji && desc) {
                    const newTags = [...customTags, { emoji, desc }];
                    setDoc(doc(db, 'userSettings', currentUser.uid), { tags: newTags }, { merge: true });
                    document.getElementById('newEmoji').value = '';
                    document.getElementById('newDesc').value = '';
                  }
                }}>Add</button>
              </div>
            </div>

            <div className="input-label">Notes & Reads</div>
            <textarea 
              value={u.notes || ''} 
              onChange={e => updateGlobalUser(u.id, { notes: e.target.value })} 
              placeholder="Enter custom reads and notes here..." 
              style={{minHeight: '100px'}}
            />
          </div>
          
          <div className="stats-grid mt-2" style={{gridTemplateColumns: 'repeat(2, 1fr)'}}>
            <div className="stat-card" style={{gridColumn: '1 / -1', background: 'var(--border)'}}>
              <div className="stat-label">NET PROFIT</div>
              <div className="stat-value" style={{color: stats.netProfit >= 0 ? 'var(--success)' : 'var(--danger)'}}>
                {stats.netProfit >= 0 ? '+' : '-'}${Math.abs(stats.netProfit)} 
                <span style={{fontSize: '1rem', color: 'var(--text-muted)'}}> (${stats.hourlyRate}/hr)</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Hours Played</div>
              <div className="stat-value">{stats.totalHours}h</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Win Rate</div>
              <div className="stat-value">{stats.winRate}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Lifetime Wins</div>
              <div className="stat-value">{stats.wins}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Hands Played</div>
              <div className="stat-value">{stats.totalHandsInvolved}</div>
            </div>
            <div className="stat-card" style={{gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem'}}>
              <div className="stat-label" style={{color: 'var(--accent)', textAlign: 'center'}}>PRE-FLOP STATS</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">VPIP</div>
              <div className="stat-value">{stats.vpip}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">PFR</div>
              <div className="stat-value">{stats.pfr}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">3Bet</div>
              <div className="stat-value">{stats.threeBet}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Fold 2 3Bet</div>
              <div className="stat-value">{stats.foldTo3Bet}%</div>
            </div>
            <div className="stat-card" style={{gridColumn: '1 / -1'}}>
              <div className="stat-label">VPIP BY POSITION (EP / MP / LP / BLINDS)</div>
              <div style={{color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.2rem', textAlign: 'center'}}>
                {stats.posVpip.Early}% / {stats.posVpip.Middle}% / {stats.posVpip.Late}% / {stats.posVpip.Blinds}%
              </div>
            </div>

            <div className="stat-card" style={{gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem'}}>
              <div className="stat-label" style={{color: 'var(--warning)', textAlign: 'center'}}>POST-FLOP STATS</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Aggression Factor (AF)</div>
              <div className="stat-value">{stats.af}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Went To Showdown (WTSD)</div>
              <div className="stat-value">{stats.wtsd}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Flop C-Bet</div>
              <div className="stat-value">{stats.cbet}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Fold to C-Bet</div>
              <div className="stat-value">{stats.foldToCbet}%</div>
            </div>
          </div>
        </div>
      );
    }

    if (users.length === 0) return <p className="panel">No global users created yet. Assign users to seats to see them here.</p>;
    
    const filteredUsers = users.filter(u => u.name.toLowerCase().includes(userSearchQuery.toLowerCase()));
    
    return (
      <div className="users-tab">
        <div className="search-bar" style={{marginBottom: '1rem'}}>
          <input 
            type="text" 
            placeholder="Search players..." 
            value={userSearchQuery}
            onChange={e => setUserSearchQuery(e.target.value)}
            style={{width: '100%', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-dark)', color: 'white', fontSize: '1rem'}}
          />
        </div>
        <div className="users-list" style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
          {filteredUsers.map(u => {
            const stats = calculateLifetimeStats(u.id);
            return (
              <div key={u.id} className="user-list-item panel hover-effect" onClick={() => setSelectedUserForModal(u.id)} style={{cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', margin: 0}}>
                <div style={{fontWeight: 'bold', fontSize: '1.2rem', color: 'var(--accent)'}}>{u.name}</div>
                <div style={{color: 'var(--text-muted)'}}>{stats.totalHandsInvolved} hands played</div>
              </div>
            );
          })}
          {filteredUsers.length === 0 && <p style={{textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem'}}>No users found.</p>}
        </div>
      </div>
    );
  };

  const handleGlobalTabChange = (tab) => {
    setViewMode(tab);
    // Reset deep views
    setSelectedHistorySessionId(null);
    setSelectedUserForModal(null);
    setUserSearchQuery('');
    
    // Default bankroll user
    if (tab === 'bankroll' && !selectedBankrollUserId && users.length > 0) {
      setSelectedBankrollUserId(users[0].id);
    }
  };

  const renderBankrollDashboard = () => {
    if (users.length === 0) return <p className="panel">No users created yet.</p>;

    const targetUser = users.find(u => u.id === selectedBankrollUserId) || users[0];
    if (!targetUser) return null;

    const stats = calculateLifetimeStats(targetUser.id);
    
    // Get sessions this user played in
    const userSessions = sessions.filter(s => s.players.some(p => p.userId === targetUser.id)).sort((a,b) => b.id - a.id);

    return (
      <div className="bankroll-dashboard">
        <div className="input-group panel mb-2">
          <label>Select Player to View Bankroll</label>
          <select 
            value={selectedBankrollUserId} 
            onChange={e => setSelectedBankrollUserId(e.target.value)}
            style={{width: '100%', padding: '0.8rem', background: 'var(--bg)', color: 'white', border: '1px solid var(--border)', borderRadius: '4px'}}
          >
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div className="stats-grid mb-2" style={{gridTemplateColumns: 'repeat(2, 1fr)'}}>
          <div className="stat-card" style={{gridColumn: '1 / -1', background: 'var(--border)'}}>
            <div className="stat-label">LIFETIME NET PROFIT</div>
            <div className="stat-value" style={{color: stats.netProfit >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: '2.5rem'}}>
              {stats.netProfit >= 0 ? '+' : '-'}${Math.abs(stats.netProfit)} 
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Hours</div>
            <div className="stat-value">{stats.totalHours}h</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Hourly Rate</div>
            <div className="stat-value" style={{color: stats.hourlyRate >= 0 ? 'var(--success)' : 'var(--danger)'}}>
              ${stats.hourlyRate}/hr
            </div>
          </div>
        </div>

        <h3>Session Breakdown</h3>
        <div className="session-list mt-1" style={{display: 'flex', flexDirection: 'column', gap: '0.8rem'}}>
          {userSessions.length === 0 && <p className="panel">No sessions played yet.</p>}
          {userSessions.map((s, idx) => {
            const p = s.players.find(x => x.userId === targetUser.id);
            const profit = p.stack - p.rebuys;
            const start = new Date(s.startTime);
            const end = s.endTime ? new Date(s.endTime) : new Date();
            const hrs = ((end - start) / (1000 * 60 * 60)).toFixed(1);

            return (
              <div key={s.id} className="panel" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 0}}>
                <div>
                  <div style={{fontWeight: 'bold', fontSize: '1.1rem'}}>{s.location || 'Home Game'} <span style={{fontSize: '0.8rem', color: 'var(--accent)'}}>{s.gameType}</span></div>
                  <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>{start.toLocaleDateString()} • {hrs}h played</div>
                </div>
                <div style={{textAlign: 'right'}}>
                  <div style={{fontWeight: 'bold', fontSize: '1.2rem', color: profit >= 0 ? 'var(--success)' : 'var(--danger)'}}>
                    {profit >= 0 ? '+' : '-'}${Math.abs(profit)}
                  </div>
                  <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>${p.rebuys} In / ${p.stack} Out</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // -- Main Render --

  if (authLoading) return <div className="app-container"><p style={{textAlign: 'center', marginTop: '2rem'}}>Loading Tracker...</p></div>;

  if (!currentUser) {
    return (
      <div className="app-container" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh'}}>
        <h1 style={{fontSize: '2.5rem', marginBottom: '2rem'}}>♠️ Poker Tracker</h1>
        
        <form onSubmit={handleAuthSubmit} className="panel" style={{width: '100%', maxWidth: '400px'}}>
          <h2 style={{marginBottom: '1rem', textAlign: 'center'}}>{authMode === 'login' ? 'Login' : 'Register'}</h2>
          
          {authError && <div style={{color: 'var(--danger)', marginBottom: '1rem', textAlign: 'center'}}>{authError}</div>}
          
          {authMode === 'register' && (
            <div className="input-group mb-1">
              <label className="input-label">Display Name</label>
              <input type="text" value={authName} onChange={e => setAuthName(e.target.value)} required />
            </div>
          )}
          
          <div className="input-group mb-1">
            <label className="input-label">Email</label>
            <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} required style={{width: '100%', padding: '0.8rem 1rem', background: 'var(--bg-dark)', color: 'white', border: '1px solid var(--border)', borderRadius: '8px'}} />
          </div>
          
          <div className="input-group mb-2">
            <label className="input-label">Password</label>
            <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} required style={{width: '100%', padding: '0.8rem 1rem', background: 'var(--bg-dark)', color: 'white', border: '1px solid var(--border)', borderRadius: '8px'}} />
          </div>
          
          <button type="submit" className="btn primary full-width mb-1">{authMode === 'login' ? 'Sign In' : 'Create Account'}</button>
          
          <div style={{textAlign: 'center', margin: '1rem 0', color: 'var(--text-muted)'}}>OR</div>
          
          <button type="button" onClick={handleGoogleLogin} className="btn secondary full-width mb-2" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'}}>
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Sign in with Google
          </button>
          
          <div style={{textAlign: 'center', fontSize: '0.9rem'}}>
            {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <span style={{color: 'var(--accent)', cursor: 'pointer', fontWeight: 'bold'}} onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
              {authMode === 'login' ? 'Register' : 'Login'}
            </span>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header>
        <h1>Poker Tracker</h1>
        <div className="header-actions" style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
          <span style={{color: 'var(--success)', fontWeight: 'bold'}}>● Synced</span>
          <button onClick={() => signOut(auth)} className="btn secondary" style={{padding: '0.4rem 0.8rem'}}>Logout</button>
        </div>
      </header>

      <div className="view-toggles" style={{gridTemplateColumns: 'repeat(4, 1fr)'}}>
        <button onClick={() => handleGlobalTabChange('session')} className={`toggle-btn ${viewMode === 'session' ? 'active' : ''}`}>Table</button>
        <button onClick={() => handleGlobalTabChange('bankroll')} className={`toggle-btn ${viewMode === 'bankroll' ? 'active' : ''}`}>Bankroll</button>
        <button onClick={() => handleGlobalTabChange('history')} className={`toggle-btn ${viewMode === 'history' ? 'active' : ''}`}>History</button>
        <button onClick={() => handleGlobalTabChange('users')} className={`toggle-btn ${viewMode === 'users' ? 'active' : ''}`}>Users</button>
      </div>

      {viewMode === 'session' && !currentSession && (
        <section className="panel" style={{padding: '2rem'}}>
          <h2 style={{marginBottom: '1.5rem', fontSize: '1.5rem', textAlign: 'center'}}>Start Session</h2>
          
          <div className="form-section">
            <h3>📍 Game Details</h3>
            <div className="input-group mb-1">
              <label className="input-label">Location</label>
              <input type="text" value={sessionLocation} onChange={e => setSessionLocation(e.target.value)} />
            </div>
            <div className="input-group mb-1">
              <label className="input-label">Game Type</label>
              <select value={sessionGameType} onChange={e => setSessionGameType(e.target.value)}>
                <option value="NLH">No Limit Hold'em (NLH)</option>
                <option value="PLO">Pot Limit Omaha (PLO)</option>
              </select>
            </div>
            <div style={{display: 'flex', gap: '1rem'}}>
              <div className="input-group" style={{flex: 1}}>
                <label className="input-label">Small Blind ($)</label>
                <input type="number" value={sbAmount} onChange={e => setSbAmount(parseFloat(e.target.value))} />
              </div>
              <div className="input-group" style={{flex: 1}}>
                <label className="input-label">Big Blind ($)</label>
                <input type="number" value={bbAmount} onChange={e => setBbAmount(parseFloat(e.target.value))} />
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>🦸‍♂️ Hero Setup</h3>
            <div className="input-group mb-1">
              <label className="input-label">Your Global Profile</label>
              <select value={heroUserId} onChange={e => setHeroUserId(e.target.value)}>
                <option value="none">-- Anonymous / Don't Seat Me --</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{display: 'flex', gap: '1rem'}}>
              <div className="input-group" style={{flex: 1}}>
                <label className="input-label">Your Seat</label>
                <select value={heroSeat} onChange={e => setHeroSeat(parseInt(e.target.value))}>
                  {Array.from({length: 9}).map((_, i) => <option key={i} value={i}>Seat {i + 1}</option>)}
                </select>
              </div>
              <div className="input-group" style={{flex: 1}}>
                <label className="input-label">Starting Stack ($)</label>
                <input type="number" value={heroBuyIn} onChange={e => setHeroBuyIn(parseFloat(e.target.value))} />
              </div>
            </div>
          </div>

          <button onClick={startSession} className="btn primary full-width" style={{padding: '1rem', fontSize: '1.1rem'}}>Start Table</button>
        </section>
      )}

      {viewMode === 'session' && currentSession && (
        <section>
          <div className="table-container">
            <div className="poker-table">
              <div className="table-surface">
                 <div className="pot-area">Pot</div>
              </div>
              
              {currentSession.players.map((p, idx) => {
                const isDealer = idx === currentSession.dealerButtonSeat;
                const isActive = idx === currentSession.activeTurnSeat;
                const isFolded = currentSession.foldedSeats.includes(idx);
                return (
                  <div key={p.userId} className={`seat seat-${idx+1} ${isActive && !currentSession.pendingShowdown ? 'active' : ''} ${isFolded ? 'folded' : ''}`} onClick={() => setModalSeatIdx(idx)}>
                    {(() => {
                      const u = users.find(x => x.id === p.userId);
                      if (u && u.tags && u.tags.length > 0) {
                        return <div className="seat-tags">{u.tags.join('')}</div>;
                      }
                      return null;
                    })()}
                    <span className="name">{p.name}</span>
                    <div className="stack">${p.stack}</div>
                    {isDealer && <div className="dealer-button">D</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {!currentSession.pendingShowdown ? (
            <div className="action-panel panel">
              <div className="action-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="street-badge">{STREETS[currentSession.currentStreet]}</div>
                <h3>Action on: <span className="highlight-text">{currentSession.players[currentSession.activeTurnSeat].name}</span></h3>
              </div>
              
              <div className="action-grid mt-2">
                {getActionButtons().map(btn => (
                  <button key={btn.action} className="btn action-btn" onClick={() => recordAction(btn.action)}>
                    {btn.label}
                  </button>
                ))}
              </div>
              <div className="hand-actions mt-2" style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={forceAdvanceStreet} className="btn secondary" style={{ flex: 1 }}>Next Street</button>
                <button onClick={() => updateSession(s => ({ ...s, pendingShowdown: true }))} className="btn warning" style={{ flex: 1 }}>Finish Hand</button>
              </div>
            </div>
          ) : (
            <div className="action-panel panel" style={{ border: '2px solid var(--warning)' }}>
              <h2 style={{ color: 'var(--warning)', textAlign: 'center', marginBottom: '1rem' }}>Select Showdown Winner</h2>
              <div className="action-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {currentSession.players.map((p, idx) => {
                  if (currentSession.foldedSeats.includes(idx)) return null;
                  return (
                    <button key={p.userId} className="btn action-btn" onClick={() => commitHand(p.userId, true)}>
                      {p.name}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => updateSession(s => ({ ...s, pendingShowdown: false }))} className="btn secondary full-width mt-2">Cancel / Back to Hand</button>
            </div>
          )}

          <button onClick={endSession} className="btn danger full-width mt-2">End Session</button>
        </section>
      )}

      {viewMode === 'history' && (
        <section>
          <h2 className="mb-2" style={{padding: '0 0.5rem'}}>History Dashboard</h2>
          {renderSessionHistory()}
        </section>
      )}

      {viewMode === 'users' && (
        <section>
          <h2 className="mb-2" style={{padding: '0 0.5rem'}}>Player Database</h2>
          {renderAllUsers()}
        </section>
      )}

      {viewMode === 'bankroll' && (
        <section>
          <h2 className="mb-2" style={{padding: '0 0.5rem'}}>Bankroll Manager</h2>
          {renderBankrollDashboard()}
        </section>
      )}



      {/* Live Table Seat Modal */}
      {modalSeatIdx !== null && typeof modalSeatIdx === 'number' && currentSession && (
        <div className="modal">
          <div className="modal-content panel">
            <div className="modal-header">
              <select 
                className="player-name-input" 
                style={{ appearance: 'none', background: 'var(--bg-dark)' }}
                value={currentSession.players[modalSeatIdx].userId}
                onChange={(e) => assignUserToSeat(modalSeatIdx, e.target.value)}
              >
                <option disabled value={currentSession.players[modalSeatIdx].userId}>{currentSession.players[modalSeatIdx].name}</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                <option value="NEW" style={{ color: 'var(--accent)' }}>+ Add New User</option>
              </select>
              <button onClick={() => setModalSeatIdx(null)} className="btn secondary">X</button>
            </div>
            
            <div className="player-stack-mgmt mt-2">
              <div className="stack-display">Stack: ${currentSession.players[modalSeatIdx].stack}</div>
              <div className="stack-actions-grid mt-1">
                <input type="number" className="small-input" placeholder="New" value={updateStackVal} onChange={e => setUpdateStackVal(e.target.value)} />
                <button onClick={() => {
                  const val = parseFloat(updateStackVal);
                  if(!isNaN(val)) {
                    updateSession(s => {
                      const p = [...s.players];
                      p[modalSeatIdx].stack = val;
                      p[modalSeatIdx].stackHistory.push({ time: new Date().toISOString(), stack: val, label: 'Update' });
                      return { ...s, players: p };
                    });
                    setUpdateStackVal('');
                  }
                }} className="btn primary">Update</button>
                <button onClick={() => {
                  const val = parseFloat(prompt('Enter rebuy amount:'));
                  if(!isNaN(val)) {
                    updateSession(s => {
                      const p = [...s.players];
                      p[modalSeatIdx].rebuys += val;
                      p[modalSeatIdx].stack += val;
                      p[modalSeatIdx].stackHistory.push({ time: new Date().toISOString(), stack: p[modalSeatIdx].stack, label: 'Rebuy' });
                      return { ...s, players: p };
                    });
                  }
                }} className="btn warning">Rebuy</button>
              </div>
            </div>
            
            {(() => {
              const stats = calculateLifetimeStats(currentSession.players[modalSeatIdx].userId);
              return (
                <div className="stats-grid mt-2" onClick={() => { setModalSeatIdx(null); setSelectedUserForModal(currentSession.players[modalSeatIdx].userId); }}>
                  <button className="btn secondary full-width" style={{gridColumn: '1 / -1'}}>View Full Lifetime Stats →</button>
                  <div className="stat-card">
                    <div className="stat-label">VPIP</div>
                    <div className="stat-value">{stats.vpip}%</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">PFR</div>
                    <div className="stat-value">{stats.pfr}%</div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
