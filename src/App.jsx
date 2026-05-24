import React, { useState, useMemo, useRef, useEffect } from 'react';
import { collection, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
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

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [users, setUsers] = useState([]); 
  const [currentSessionId, setCurrentSessionId] = useState(null);
  
  // 'session', 'history', 'users'
  const [viewMode, setViewMode] = useState('session');
  
  const [sbAmount, setSbAmount] = useState(1);
  const [bbAmount, setBbAmount] = useState(2);
  
  const [modalSeatIdx, setModalSeatIdx] = useState(null);
  const [updateStackVal, setUpdateStackVal] = useState('');
  
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [selectedUserForModal, setSelectedUserForModal] = useState(null);
  const [selectedHistorySessionId, setSelectedHistorySessionId] = useState(null);

  const fileHandleRef = useRef(null);

  const currentSession = useMemo(() => sessions.find(s => s.id === currentSessionId), [sessions, currentSessionId]);

  useEffect(() => {
    const unsubSessions = onSnapshot(collection(db, 'sessions'), (snapshot) => {
      const fetched = snapshot.docs.map(d => d.data());
      setSessions(fetched);
    });
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const fetched = snapshot.docs.map(d => d.data());
      setUsers(fetched);
    });
    return () => { unsubSessions(); unsubUsers(); };
  }, []);

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

  const createAnonymousPlayer = (idx) => ({
    userId: `anon_${Date.now()}_${idx}`,
    name: `S${idx+1}`,
    stack: 0,
    rebuys: 0,
    stackHistory: [{ time: new Date().toISOString(), stack: 0, label: 'Join' }]
  });

  const startSession = () => {
    const players = Array.from({ length: NUM_SEATS }, (_, i) => createAnonymousPlayer(i));
    const newSession = {
      id: Date.now(),
      startTime: new Date().toISOString(),
      endTime: null,
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
    const newUser = { id: `u_${Date.now()}`, name };
    setDoc(doc(db, 'users', newUser.id), newUser).catch(console.error);
    setUsers(prev => {
      if (prev.find(u => u.id === newUser.id)) return prev;
      return [...prev, newUser];
    });
    return newUser;
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
    
    targetSessions.forEach(s => {
      const allHands = [...s.hands];
      if (s.currentHandActions && s.currentHandActions.length > 0) {
        allHands.push({ actions: s.currentHandActions, winnerId: null, wentToShowdown: false });
      }

      allHands.forEach(hand => {
        const playerActions = hand.actions.filter(a => a.playerId === userId);
        if (playerActions.length > 0) {
          totalHandsInvolved++;
          
          if (hand.winnerId === userId) {
            wins++;
            if (hand.wentToShowdown) showdownWins++;
          }

          const preflopActions = playerActions.filter(a => a.street === 0);
          if (preflopActions.length > 0) {
            preflopHandsPlayed++;
            
            const vpip = preflopActions.some(a => ['call', 'raise', '3bet', '4bet'].includes(a.action));
            const pfr = preflopActions.some(a => ['raise', '3bet', '4bet'].includes(a.action));
            const threeBet = preflopActions.some(a => a.action === '3bet');
            const faced3bFold = preflopActions.some(a => a.action === 'fold' && a.facing === '3bet');
            const faced3bCall = preflopActions.some(a => ['call','4bet'].includes(a.action) && a.facing === '3bet');
            
            if (vpip) vpipCount++;
            if (pfr) pfrCount++;
            if (threeBet) threeBetCount++;
            if (faced3bFold || faced3bCall) f3betOpp++;
            if (faced3bFold) f3betFold++;
          }
        }
      });
    });

    return {
      totalHandsInvolved,
      wins,
      showdownWins,
      vpip: preflopHandsPlayed ? Math.round((vpipCount / preflopHandsPlayed) * 100) : 0,
      pfr: preflopHandsPlayed ? Math.round((pfrCount / preflopHandsPlayed) * 100) : 0,
      threeBet: preflopHandsPlayed ? Math.round((threeBetCount / preflopHandsPlayed) * 100) : 0,
      foldTo3Bet: f3betOpp ? Math.round((f3betFold / f3betOpp) * 100) : 0,
      winRate: totalHandsInvolved ? Math.round((wins / totalHandsInvolved) * 100) : 0
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
  };

  // -- Main Render --
  return (
    <div className="app-container">
      <header>
        <h1>Poker Tracker (Cloud Sync Live)</h1>
        <div className="header-actions">
          <span style={{color: 'var(--success)', fontWeight: 'bold'}}>● Synced to Firebase</span>
        </div>
      </header>

      <div className="view-toggles">
        <button onClick={() => handleGlobalTabChange('session')} className={`toggle-btn ${viewMode === 'session' ? 'active' : ''}`}>Live Table</button>
        <button onClick={() => handleGlobalTabChange('history')} className={`toggle-btn ${viewMode === 'history' ? 'active' : ''}`}>History</button>
        <button onClick={() => handleGlobalTabChange('users')} className={`toggle-btn ${viewMode === 'users' ? 'active' : ''}`}>All Users</button>
      </div>

      {viewMode === 'session' && !currentSession && (
        <section className="panel">
          <h2>Start 9-Max Session</h2>
          <div className="input-group">
            <label>Small Blind ($)</label>
            <input type="number" value={sbAmount} onChange={e => setSbAmount(parseFloat(e.target.value))} />
          </div>
          <div className="input-group mt-1 mb-2">
            <label>Big Blind ($)</label>
            <input type="number" value={bbAmount} onChange={e => setBbAmount(parseFloat(e.target.value))} />
          </div>
          <button onClick={startSession} className="btn primary full-width mt-2">Start Session</button>
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

      {/* Global User Stats Modal */}
      {selectedUserForModal && (() => {
        const u = users.find(x => x.id === selectedUserForModal);
        if (!u) return null;
        const stats = calculateLifetimeStats(u.id);
        return (
          <div className="modal" onClick={() => setSelectedUserForModal(null)}>
            <div className="modal-content panel" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 style={{color: 'var(--accent)', margin: 0}}>{u.name}</h2>
                <button onClick={() => setSelectedUserForModal(null)} className="btn secondary">X</button>
              </div>
              
              <div className="stats-grid mt-2" style={{gridTemplateColumns: 'repeat(2, 1fr)'}}>
                <div className="stat-card" style={{gridColumn: '1 / -1', background: 'var(--border)'}}>
                  <div className="stat-label">LIFETIME WINS</div>
                  <div className="stat-value" style={{color: 'white'}}>{stats.wins} <span style={{fontSize: '1rem', color: 'var(--success)'}}>({stats.showdownWins} at Showdown)</span></div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Win %</div>
                  <div className="stat-value">{stats.winRate}%</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Hands Played</div>
                  <div className="stat-value">{stats.totalHandsInvolved}</div>
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
              </div>
            </div>
          </div>
        );
      })()}

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
