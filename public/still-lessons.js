// Lesson body copy supplied by Pat / Claude. Illustrations are conceptual, not market data.
export const STILL_LESSONS = [
  {
    "id": 1,
    "title": "What an LP range is",
    "body": "When you LP on a Meteora DLMM pool, you don't provide liquidity at every price. You choose a range. While the price trades inside it, your liquidity is used for swaps and you earn a share of the fees. When the price moves outside your range, you stop earning. If it falls below, you end up holding the token that fell. If it rises above, you end up holding SOL. A narrow range works harder while it lasts. A wide range lasts longer and earns less per swap. Pick the range for the trade you're making, not for the one you hope for.",
    "example": "Inside the band: earning swap fees. Outside: holding one side.",
    "diagram": "range"
  },
  {
    "id": 2,
    "title": "Spot vs Bid-Ask vs Curve",
    "body": "These are the shapes Meteora offers for spreading your liquidity across a range. Spot spreads it evenly, so every price in your range gets the same amount. It's the simplest place to start. Curve bunches it near the current price. It earns more while price stays put and less once it moves. Bid-Ask puts more at the edges of your range. It suits buying dips and selling into rises, and works best when you expect price to swing. None of these is better. Each suits a different idea of what the price will do.",
    "example": "Spot: even · Curve: centre · Bid-Ask: edges.",
    "diagram": "shapes"
  },
  {
    "id": 3,
    "title": "Why exit cost matters on thin tokens",
    "body": "When you close a position, you usually swap the token back to SOL. On a thin token, that swap moves the price against you. The smaller the liquidity, the bigger the hit. This is easy to miss, because fees look good on screen and the cost only shows up when you leave. I once closed a trade that looked profitable and came out flat after the exit swap. Pre-flight quotes your exit at your size before you go in, so you can see whether your fees will cover it.",
    "example": "Example: fees earned → exit swap cost → what remains. A profitable-looking trade can come out flat.",
    "diagram": "cost"
  },
  {
    "id": 4,
    "title": "Token-2022 transfer taxes",
    "body": "Some Solana tokens use Token-2022, which lets the creator charge a fee on every transfer. Depositing into a pool is a transfer. So is withdrawing. So is the swap out. Each move pays the tax, so a small percentage adds up across a round trip, before you've earned a single fee. Some wallets and sites don't show it clearly. Pre-flight reads the token's settings directly and tells you the rate, or says \"unavailable\" if it can't read it.",
    "example": "Deposit → withdraw → swap out. Each token transfer may have a fee.",
    "diagram": "tax"
  },
  {
    "id": 5,
    "title": "Don't enter mid-spike",
    "body": "A fresh launch can jump in minutes. The fees look huge, so it's tempting to jump in. But if you open a range at the top of a spike, the first pullback can take you straight out of range, holding a token worth less than you paid. Often it's better to wait for the price to settle, or open your range below the current price so a pullback works for you. Pre-flight compares price to its recent average and flags when you'd be buying the top.",
    "example": "A spike → an entry at the top → a pullback through the floor. Waiting is a valid choice.",
    "diagram": "spike"
  },
  {
    "id": 6,
    "title": "Narrow and short vs wide and overnight",
    "body": "Both are valid. They earn very differently. In my own trading, wide ranges left overnight have earned tiny fees. They're calm, but the money is small. Narrow ranges held for a short time during a volume burst have earned far more. They also need attention, and exit cost and timing matter much more. Neither is \"right\". Decide which trade you're making before you open it, and set your floor and hold time to match.",
    "example": "Narrow + short: more attention. Wide + overnight: less attention, often smaller fees.",
    "diagram": "hold"
  },
  {
    "id": 7,
    "title": "Reading fees vs TVL",
    "body": "TVL is how much is in the pool. Fees are what traders paid. Fees divided by TVL tells you how hard each pound in the pool is working. A big pool with modest fees may pay less per SOL than a small pool with busy trading. But high fees against small TVL often mean a young or thin pool, where exit cost and holder risk are higher. Look at the ratio, then check what's behind it. Pre-flight does both.",
    "example": "Fees ÷ TVL = fee pace. A useful comparison, followed by the risk checks.",
    "diagram": "ratio"
  },
  {
    "id": 8,
    "title": "Where to put profits",
    "body": "When a trade works, the profit tends to sit in your wallet until the next trade. That's fine if you meant it. Often it's just habit. Still asks you to decide. You can put it back into a pool you've checked, spread it across a Cesto token basket, or move it into slower Backyard yield, like lending vaults or liquid staking. Each has different risks and none is guaranteed. The point is choosing, rather than letting the next ping choose for you.",
    "example": "Pools · Baskets · Backyard. Choose a purpose for the profit.",
    "diagram": "profits"
  }
];
