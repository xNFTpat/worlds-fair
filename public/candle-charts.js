(function(root){
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const price=v=>Number(v).toLocaleString(undefined,{maximumSignificantDigits:6});
  function cleanCandles(rows){
    const byTime=new Map();
    for(const c of rows||[])if([c.t,c.o,c.h,c.l,c.c].every(Number.isFinite)&&Number.isInteger(c.t)&&c.t>0&&c.l>0&&c.h>=Math.max(c.o,c.c)&&c.l<=Math.min(c.o,c.c))
      byTime.set(c.t,{time:c.t,open:c.o,high:c.h,low:c.l,close:c.c});
    return [...byTime.values()].sort((a,b)=>a.time-b.time);
  }
  function orientEstimate(e,meta){
    if(e.status!=='estimated')return e;
    const same=e.baseAddress===meta.baseAddress&&e.quoteAddress===meta.quoteAddress;
    const reverse=e.baseAddress===meta.quoteAddress&&e.quoteAddress===meta.baseAddress;
    if(!same&&!reverse)return {status:'unavailable',price:null,note:'Chart token identities do not match the break-even model.'};
    const valid=v=>Number.isFinite(v)&&v>0;
    if(!valid(e.price)||!valid(e.currentPrice))return {status:'unavailable',price:null,note:'Break-even price is unavailable.'};
    return reverse?{...e,price:1/e.price,currentPrice:1/e.currentPrice,changePct:(e.currentPrice/e.price-1)*100}:e;
  }
  const active=new Set();
  let observer;
  function mount(host,rows,meta={}){
    host._lpChart?.dispose();
    const data=cleanCandles(rows),L=root.LightweightCharts;
    if(!L||!data.length){host.textContent=!data.length?'No verified candle data available.':'Chart library did not load. Refresh to try again.';return null;}
    host.innerHTML=`<section class="candle-view"><div class="candle-toolbar"><span>1h candles</span><div>${meta.onRefresh?'<button type="button" data-chart-refresh>Refresh chart ↻</button>':''}<button type="button" data-window="24">1D</button><button type="button" data-window="72" aria-pressed="true">3D</button><button type="button" data-window="all">All</button><button type="button" data-levels aria-pressed="false">Show levels</button></div></div><div class="candle-ohlc"></div><div class="candle-canvas" role="img" aria-label="Interactive candlestick price chart. Drag to pan, pinch or scroll to zoom."></div><div class="candle-levels"></div><div class="candle-estimate" aria-live="polite"></div><p class="candle-meta">${esc(meta.chartUnit||'')} · Last candle ${new Date(data.at(-1).time*1000).toLocaleString()} · read ${meta.fetchedAt?new Date(meta.fetchedAt).toLocaleTimeString():'time unavailable'} · drag / pinch to explore</p><details class="candle-data"><summary>Candle values and chart credits</summary><p>TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc. <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView</a> · <a href="/vendor/lightweight-charts-LICENSE.txt" target="_blank">License</a></p><div class="history-scroll"><table><thead><tr><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th></tr></thead><tbody>${data.slice(-24).map(c=>`<tr><td>${new Date(c.time*1000).toLocaleString()}</td>${['open','high','low','close'].map(k=>`<td>${price(c[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><small>Latest 24 hourly candles. Missing hours are not interpolated here.</small></details></section>`;
    const refresh=host.querySelector('[data-chart-refresh]');
    if(refresh)refresh.onclick=async()=>{refresh.disabled=true;refresh.textContent='Refreshing…';try{await meta.onRefresh();}finally{if(refresh.isConnected){refresh.disabled=false;refresh.textContent='Refresh chart ↻';}}};
    const canvas=host.querySelector('.candle-canvas'),ohlc=host.querySelector('.candle-ohlc'),levels=host.querySelector('.candle-levels'),estimate=host.querySelector('.candle-estimate');
    let bounds={lower:meta.lower,upper:meta.upper},model=null,showLevels=false,lines=[],disposed=false;
    const chart=L.createChart(canvas,{autoSize:true,layout:{background:{type:'solid',color:'#faf7ee'},textColor:'#5a6250',fontFamily:'Instrument Sans, sans-serif',fontSize:10,attributionLogo:true},
      grid:{vertLines:{color:'#eeeadd'},horzLines:{color:'#eeeadd'}},rightPriceScale:{borderColor:'#d7dacb',scaleMargins:{top:0.16,bottom:0.12}},
      timeScale:{borderColor:'#d7dacb',timeVisible:true,secondsVisible:false},crosshair:{mode:L.CrosshairMode.Normal},
      handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true}});
    const minimum=Math.min(...data.map(c=>c.low)),precision=Math.min(16,Math.max(2,Math.ceil(-Math.log10(minimum))+4));
    const series=chart.addSeries(L.CandlestickSeries,{upColor:'#536e42',downColor:'#ad5d3f',borderVisible:false,wickUpColor:'#536e42',wickDownColor:'#ad5d3f',priceLineColor:'#67765c',
      priceFormat:{type:'custom',formatter:v=>Math.abs(v)<10**-precision*0.1?'0':price(v),minMove:10**-precision},autoscaleInfoProvider:original=>{
        const r=original();if(!r)return r;
        const extra=showLevels?[bounds.lower,bounds.upper,model?.price]:[model?.price].filter(v=>v>=r.priceRange.minValue/2&&v<=r.priceRange.maxValue*2);
        for(const v of extra)if(Number.isFinite(v)&&v>0){r.priceRange.minValue=Math.min(r.priceRange.minValue,v);r.priceRange.maxValue=Math.max(r.priceRange.maxValue,v);}return r;
      }});
    series.setData(data);
    const showOhlc=c=>{ohlc.textContent=`O ${price(c.open)}   H ${price(c.high)}   L ${price(c.low)}   C ${price(c.close)}`;};
    showOhlc(data.at(-1));
    chart.subscribeCrosshairMove(param=>showOhlc(param.seriesData.get(series)||data.at(-1)));
    const windowSize=n=>chart.timeScale().setVisibleLogicalRange({from:Math.max(0,data.length-n),to:data.length+3});
    const initialWindow=canvas.clientWidth<450?24:72;windowSize(initialWindow);
    host.querySelectorAll('[data-window]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.window===String(initialWindow))));
    host.querySelectorAll('[data-window]').forEach(button=>button.onclick=()=>{host.querySelectorAll('[data-window]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));windowSize(button.dataset.window==='all'?data.length:Number(button.dataset.window));});
    host.querySelector('[data-levels]').onclick=e=>{showLevels=!showLevels;e.currentTarget.setAttribute('aria-pressed',String(showLevels));chart.priceScale('right').applyOptions({autoScale:true});series.applyOptions({});};
    const drawLines=()=>{
      for(const line of lines)series.removePriceLine(line);lines=[];
      const add=(value,title,color,style)=>{if(Number.isFinite(value)&&value>0)lines.push(series.createPriceLine({price:value,title,color,lineWidth:title.startsWith('Break-even')?2:1,lineStyle:style,axisLabelVisible:true}));};
      add(bounds.lower,'Range low','#af7940',L.LineStyle.Dashed);add(bounds.upper,'Range high','#af7940',L.LineStyle.Dashed);
      if(model?.status==='estimated'){
        add(model.price,'Break-even ≈','#667fa3',L.LineStyle.Dotted);
        add(model.currentPrice,'Pool read','#536e42',L.LineStyle.Solid);
      }
      levels.textContent=Number.isFinite(bounds.lower)&&Number.isFinite(bounds.upper)?`LP range ${price(bounds.lower)} – ${price(bounds.upper)} ${meta.chartUnit||''}`:'Range unavailable';
      series.applyOptions({priceLineVisible:model?.status!=='estimated',lastValueVisible:model?.status!=='estimated'});
    };
    const api={host,setBounds(next){bounds=next;drawLines();},setEstimate(raw){
      if(disposed)return;model=orientEstimate(raw,meta);drawLines();
      if(model.status==='estimated'){
        const move=(model.changePct>0?'+':'')+model.changePct.toFixed(1)+'%';
        estimate.innerHTML=`<strong>Break-even ≈ ${price(model.price)} ${esc(meta.chartUnit)}</strong><span>${move} from the model's current pool price · fees included · before exit costs</span><details><summary>Estimate assumptions</summary><p>${esc(model.note)}</p><p>SOL held at $${Number(model.quoteUsd).toFixed(2)} · checked ${new Date(model.fetchedAt).toLocaleString()}. “Show levels” includes lines outside the visible price scale.</p></details>`;
      }else estimate.innerHTML=`<span>${esc(model.status==='unreachable'?'No break-even price with this liquidity and today’s accrued fees at fixed SOL/USD. The model tops out below your cost.':model.status==='no-loss-crossing'?'No loss threshold in this fixed-SOL-price model: amounts already recovered cover the cost.':`Break-even line unavailable. ${model.note||''}`)}</span>`;
    },dispose(){if(disposed)return;disposed=true;chart.remove();active.delete(api);if(host._lpChart===api)delete host._lpChart;}};
    host._lpChart=api;active.add(api);
    if(!observer&&typeof MutationObserver!=='undefined'){observer=new MutationObserver(()=>{for(const view of active)if(!view.host.isConnected)view.dispose();});observer.observe(document.body,{childList:true,subtree:true});}
    drawLines();return api;
  }
  root.LPCandles={mount,cleanCandles,orientEstimate};
})(globalThis);
