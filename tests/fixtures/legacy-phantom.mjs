// Connection only. This module never signs messages or builds/sends transactions.
export function createPhantomSession(getProvider, onChange) {
  let provider, address=null, pending=false, revision=0;
  const emit=(message='')=>onChange({address,pending,message});
  const changed=key=>{revision++;address=key?.toString()||null;emit(address?'':'Disconnected.');};
  const disconnected=()=>changed(null);
  const bind=p=>{
    if(provider===p)return;
    provider?.removeListener?.('accountChanged',changed);
    provider?.removeListener?.('disconnect',disconnected);
    provider=p;
    p.on?.('accountChanged',changed);p.on?.('disconnect',disconnected);
  };
  return {
    async connect(){
      if(pending)return;
      const p=getProvider();
      if(!p?.isPhantom){emit('Phantom is not available here. Use the Phantom browser extension, or open this site inside Phantom on mobile.');return;}
      bind(p);pending=true;emit('Approve the connection in Phantom.');const request=revision;
      try{const result=await p.connect();if(revision===request)address=result.publicKey.toString();}
      catch(e){if(revision===request){address=null;emit(e?.code===4001?'Connection cancelled.':'Could not connect. Unlock Phantom and try again.');}}
      finally{pending=false;emit();}
    },
    async disconnect(){
      if(pending)return;
      pending=true;revision++;emit();
      try{await provider?.disconnect();address=null;emit('Disconnected.');}
      catch{emit('Could not disconnect. You can disconnect this site in Phantom.');}
      finally{pending=false;emit();}
    }
  };
}

export function mountPhantom(){
  const connect=document.querySelector('#connectPhantom'),disconnect=document.querySelector('#disconnectPhantom'),status=document.querySelector('#phantomStatus');
  let lastMessage='Connect to approve reviewed Solana zaps.';
  const session=createPhantomSession(()=>window.phantom?.solana, s=>{
    if(s.message)lastMessage=s.message;
    connect.disabled=s.pending||!!s.address;disconnect.disabled=s.pending;disconnect.hidden=!s.address;
    connect.textContent=s.pending?'Waiting for Phantom…':s.address?'Phantom connected':'Connect Phantom · Solana';
    status.textContent=s.address?`Connected Solana address: ${s.address}. Portfolio below still tracks Pat’s saved wallets. Review a SOL-paired pool to enter or close a position.`:lastMessage;
  });
  connect.onclick=()=>session.connect();disconnect.onclick=()=>session.disconnect();
}
if(typeof document!=='undefined')mountPhantom();
