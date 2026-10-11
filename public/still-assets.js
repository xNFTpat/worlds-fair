/** Official static assets. Provenance and hashes: /partners/asset-provenance.json.
 * Unknown token mints return null; render a neutral circle, never another ticker’s logo.
 * Source URLs are attribution metadata only. No runtime network lookups. */
export const ASSET_NOTICE = "Logos belong to their owners. Still is not affiliated.";
export const PARTNER_ASSETS = Object.freeze({
  "meteora": {
    "src": "/partners/meteora.svg",
    "name": "Meteora",
    "sourceUrl": "https://raw.githubusercontent.com/MeteoraAg/brand-kit/31e6db13b7abe03e98dceb6e059479d6f29ab1bd/meteora-v2/full-logo/full-logo-on-white.svg",
    "sourcePage": "https://docs.meteora.ag/resources/miscellaneous/brand-kit",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "e4e57d215ff914de53ecc60b6cd95133dece53017e876bee508acc91c9e30bcb",
    "bytes": 9095,
    "kind": "wordmark"
  },
  "cesto": {
    "src": "/partners/cesto.png",
    "name": "Cesto",
    "sourceUrl": "https://res.cloudinary.com/dcyihhgo6/image/upload/cesto_favicon.png",
    "sourcePage": "https://cesto.co/",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "049d0b8e759ce838f81a6d00b088e7b212d6f6839dac65d1fbfd45285dbee85c",
    "bytes": 5008,
    "kind": "mark",
    "wordmark": {
      "src": "/partners/cesto-wordmark.svg",
      "sourceUrl": "https://res.cloudinary.com/dcyihhgo6/image/upload/cesto-logo.svg",
      "sourcePage": "https://cesto.co/",
      "requiresDarkBackground": true,
      "retrievedAt": "2026-10-11T14:29:21.025062Z",
      "sha256": "48eeba8fcc841b4d3563c58a6c60a1282387ee2d9eb8c7302bb87dbea8f12adb",
      "bytes": 5599
    }
  },
  "backyard": {
    "src": "/partners/backyard.svg",
    "name": "Backyard",
    "sourceUrl": "https://backyard.finance/assets/backyard-logo-C9jaMcwz.svg",
    "sourcePage": "https://backyard.finance/",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "cc22580a4b49145b8b359369ec1084d2be6d4af1a9b4b7dc90284343d156e54d",
    "bytes": 12475,
    "kind": "mark"
  }
});
export const TOKEN_ASSETS = Object.freeze({
  "14Tqdo8V1FhzKsE3W2pFsZCzYPQxxupXRcqw9jv6ondo": {
    "src": "/tokens/14Tqdo8V1FhzKsE3W2pFsZCzYPQxxupXRcqw9jv6ondo.png",
    "name": "Amazon",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/amznon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "a7a79eb0dabc646d2b547da6e4d71d6d0decc1184fa32629363d0d34d11e5441",
    "bytes": 4958,
    "mint": "14Tqdo8V1FhzKsE3W2pFsZCzYPQxxupXRcqw9jv6ondo",
    "symbol": "AMZNon"
  },
  "14diAn5z8kjrKwSC8WLqvBqqe5YmihJhjxRxd8Z6ondo": {
    "src": "/tokens/14diAn5z8kjrKwSC8WLqvBqqe5YmihJhjxRxd8Z6ondo.png",
    "name": "AMD",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/amdon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "867efa3d4fcede3849a5a457c4d8f78bcceafce62e898974b1325b3fb44fc949",
    "bytes": 4488,
    "mint": "14diAn5z8kjrKwSC8WLqvBqqe5YmihJhjxRxd8Z6ondo",
    "symbol": "AMDon"
  },
  "1FWZtdWN7y38BSXGzbs8D6Shk88oL9atDNgbVz9ondo": {
    "src": "/tokens/1FWZtdWN7y38BSXGzbs8D6Shk88oL9atDNgbVz9ondo.png",
    "name": "Broadcom",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/avgoon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "2cc7a3c19b9381c5edc15ce8e53ffe7812137727d31ad256278047a90dbacf9f",
    "bytes": 5511,
    "mint": "1FWZtdWN7y38BSXGzbs8D6Shk88oL9atDNgbVz9ondo",
    "symbol": "AVGOon"
  },
  "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4": {
    "src": "/tokens/27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4.png",
    "name": "Jupiter Liquidity Provider",
    "sourceUrl": "https://static.jup.ag/jlp/icon.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "7df599a8066a482b7ab4ab721c8f082910416f8eb152a9513d9b9d9d07966d4d",
    "bytes": 4522,
    "mint": "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
    "symbol": "JLP"
  },
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": {
    "src": "/tokens/2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo.png",
    "name": "PayPal USD",
    "sourceUrl": "https://424565.fs1.hubspotusercontent-na1.net/hubfs/424565/PYUSDLOGO.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "a4905d4321ebab83993a8ac4c5a2d6902cffd354deb3bf5db9d21eaeca0e8033",
    "bytes": 5991,
    "mint": "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    "symbol": "PYUSD"
  },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": {
    "src": "/tokens/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R.png",
    "name": "Raydium",
    "sourceUrl": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "4f19e48447cfb97915021bfa277349d9aa784198261f777a00d8fdf8a1d43fe1",
    "bytes": 45090,
    "mint": "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    "symbol": "RAY"
  },
  "59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw": {
    "src": "/tokens/59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw.svg",
    "name": "Poolside Token",
    "sourceUrl": "https://meta.huma.finance/pst.svg",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "040d1d5b923234d61e0d073b126ffeaca45ba02bfdcae4a49902163aec2f7aaf",
    "bytes": 799,
    "mint": "59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw",
    "symbol": "PST"
  },
  "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx": {
    "src": "/tokens/6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx.webp",
    "name": "STONK",
    "sourceUrl": "https://static.datapi.jup.ag/images/asset-icon/stonk.webp",
    "sourcePage": "https://datapi.jup.ag/v1/assets/search?query=6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "5964b82bd5d46f3dd28e38f5c179985d9926def675f0d0b374718b5f567969e3",
    "bytes": 2128,
    "mint": "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx",
    "symbol": "STONK"
  },
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN": {
    "src": "/tokens/6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN.jpg",
    "name": "Official Trump",
    "symbol": "TRUMP",
    "mint": "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
    "sourceUrl": "https://cdn.helius-rpc.com/cdn-cgi/image//https://arweave.net/VQrPjACwnQRmxdKBTqNwPiyo65x7LAT773t8Kd7YBzw",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "9b6c706e030b969e89ed1bcbcf0ee655200069ffa7bdf842936a0b36e34a254f",
    "bytes": 1526550
  },
  "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g": {
    "src": "/tokens/98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g.png",
    "name": "Hyperliquid",
    "sourceUrl": "https://arweave.net/QBRdRop8wI4PpScSRTKyibv-fQuYBua-WOvC7tuJyJo",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "4d210e44f273db8d4089cd44c86e24c057969495c8ba32d1331c30badd91102e",
    "bytes": 11031,
    "mint": "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g",
    "symbol": "HYPE",
    "resolvedUrl": "https://iakf2rukptai4d5fe4jekmvsrg5747iltadonpsy5pbo5w4jzcna.arweave.net/QBRdRop8wI4PpScSRTKyibv-fQuYBua-WOvC7tuJyJo"
  },
  "A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6": {
    "src": "/tokens/A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6.png",
    "name": "Ondo US Dollar Yield",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/usdy_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "7f0e04e7352ac0408f569a69715ac1f930b35f9eab77ce5069766af746f335cb",
    "bytes": 20835,
    "mint": "A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6",
    "symbol": "USDY"
  },
  "BfPGpgNyxe6rjAru1EJarjSBAcCABuMF5L32v7nondo": {
    "src": "/tokens/BfPGpgNyxe6rjAru1EJarjSBAcCABuMF5L32v7nondo.png",
    "name": "CoreWeave (Ondo Tokenized)",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/crwvon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "66c0d6a6807aa1da7afca623e7e39124bac782195eb3eae7c3379556fee117d8",
    "bytes": 6064,
    "mint": "BfPGpgNyxe6rjAru1EJarjSBAcCABuMF5L32v7nondo",
    "symbol": "CRWVon"
  },
  "C8fU5GdfAt5mnw2RK7HE6XJGFNxHpaskZMkXxdm88888": {
    "src": "/tokens/C8fU5GdfAt5mnw2RK7HE6XJGFNxHpaskZMkXxdm88888.svg",
    "name": "c8ntinuum",
    "sourceUrl": "https://raw.githubusercontent.com/c8ntinuum/resources/main/ctm_dark.svg",
    "sourcePage": "https://datapi.jup.ag/v1/assets/search?query=C8fU5GdfAt5mnw2RK7HE6XJGFNxHpaskZMkXxdm88888",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "fa6a1686c8025889e04e963227392cf3e1fe407ab620d9303568ab1bb4376957",
    "bytes": 1340,
    "mint": "C8fU5GdfAt5mnw2RK7HE6XJGFNxHpaskZMkXxdm88888",
    "symbol": "CTM"
  },
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": {
    "src": "/tokens/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263.jpg",
    "name": "Bonk",
    "sourceUrl": "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "498ca3589dbe075f0cfed24f7e7a31ba868079ad98e3e25813893eaa99092c31",
    "bytes": 48373,
    "mint": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "symbol": "BONK",
    "resolvedUrl": "https://quei6zhlcfsxdfyes577gy7bkxmuz7qqakyt72xlbkyh7fysmoza.arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I"
  },
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": {
    "src": "/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.png",
    "name": "USD Coin",
    "sourceUrl": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "6d14601d0b1109046e366592b8c0f256ffb075f69180b65dddd97ae665d49f9e",
    "bytes": 9276,
    "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "symbol": "USDC"
  },
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": {
    "src": "/tokens/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB.svg",
    "name": "Tether USD",
    "sourceUrl": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "ebe5e8004bc8a9e681f3208c5f838abd5536ed8e4eae243486a430ba70a90ab1",
    "bytes": 1173,
    "mint": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "symbol": "USDT"
  },
  "EsVHcyRxXFJCLMiuYLWhoDygrNe1BJGpYeZ17X7ondo": {
    "src": "/tokens/EsVHcyRxXFJCLMiuYLWhoDygrNe1BJGpYeZ17X7ondo.png",
    "name": "Mastercard",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/maon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "6c69e13a8ebdcc57ef0fe8470d4e6eee8f98585d5c548afe177dcb802d3a4688",
    "bytes": 4412,
    "mint": "EsVHcyRxXFJCLMiuYLWhoDygrNe1BJGpYeZ17X7ondo",
    "symbol": "MAon"
  },
  "FRmH6iRkMr33DLG6zVLR7EM4LojBFAuq6NtFzG6ondo": {
    "src": "/tokens/FRmH6iRkMr33DLG6zVLR7EM4LojBFAuq6NtFzG6ondo.png",
    "name": "Microsoft",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/msfton_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "bcbfca5825308c79fa4bf2169157ffed6bbc693c87c6bdaacf02c14fb6213f12",
    "bytes": 3347,
    "mint": "FRmH6iRkMr33DLG6zVLR7EM4LojBFAuq6NtFzG6ondo",
    "symbol": "MSFTon"
  },
  "GmDADFpfwjfzZq9MfCafMDTS69MgVjtzD7Fd9a4ondo": {
    "src": "/tokens/GmDADFpfwjfzZq9MfCafMDTS69MgVjtzD7Fd9a4ondo.png",
    "name": "Oracle",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/orclon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "e2b4a390e2c751a2f2a118c32b7437bcff0b8553ae230711fb3606a213af7261",
    "bytes": 4732,
    "mint": "GmDADFpfwjfzZq9MfCafMDTS69MgVjtzD7Fd9a4ondo",
    "symbol": "ORCLon"
  },
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn": {
    "src": "/tokens/J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn.png",
    "name": "Jito Staked SOL",
    "sourceUrl": "https://storage.googleapis.com/token-metadata/JitoSOL-256.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "e20ee15a9582c62d2257b5fe306e3619ba2d14d745341dbc6498f14429bd9730",
    "bytes": 50589,
    "mint": "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    "symbol": "JitoSOL"
  },
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": {
    "src": "/tokens/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN.png",
    "name": "Jupiter",
    "sourceUrl": "https://static.jup.ag/jup/icon.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "5f460c59d968c0af5a4dee3e19c5e51f0298f15ae3fac907e9e4c0904bec7506",
    "bytes": 28312,
    "mint": "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    "symbol": "JUP"
  },
  "JrTYw7A9jihX5TwpRStYviEbsYf2X2VJpZ13719ondo": {
    "src": "/tokens/JrTYw7A9jihX5TwpRStYviEbsYf2X2VJpZ13719ondo.png",
    "name": "S&P Global",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/spgion_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "e773a27677f20692923407224df78fbc04c3c01d1e835be74c495a3069fda86c",
    "bytes": 5278,
    "mint": "JrTYw7A9jihX5TwpRStYviEbsYf2X2VJpZ13719ondo",
    "symbol": "SPGIon"
  },
  "KJNeFW3kk3ycPjXpC6cbuyckjeYHacc2ekhtAi5ondo": {
    "src": "/tokens/KJNeFW3kk3ycPjXpC6cbuyckjeYHacc2ekhtAi5ondo.png",
    "name": "Uber",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/uberon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "ab7b7bf8faf7a3662d4cb52893bdc425fd94240c30ef4671aff5eed4c571008b",
    "bytes": 4165,
    "mint": "KJNeFW3kk3ycPjXpC6cbuyckjeYHacc2ekhtAi5ondo",
    "symbol": "UBERon"
  },
  "M77ZvkZ8zW5udRbuJCbuwSwavRa7bGAZYMTwru8ondo": {
    "src": "/tokens/M77ZvkZ8zW5udRbuJCbuwSwavRa7bGAZYMTwru8ondo.png",
    "name": "iShares Gold Trust",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/iauon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "dfa6863c3286303acd3c6cdbebe2ab475614f45533d839e66730e8b7f825bbe6",
    "bytes": 4667,
    "mint": "M77ZvkZ8zW5udRbuJCbuwSwavRa7bGAZYMTwru8ondo",
    "symbol": "IAUon"
  },
  "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw": {
    "src": "/tokens/Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw.png",
    "name": "Anthropic PreStocks",
    "sourceUrl": "https://www.prestocks.com/logos/anthropic.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "0aef3aadf5ad4324f34ea52fb02592fe9125e5b502c9eace00d20c189b400a65",
    "bytes": 16200,
    "mint": "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    "symbol": "ANTHROPIC",
    "resolvedUrl": "https://prestocks.com/logos/anthropic.png"
  },
  "So11111111111111111111111111111111111111112": {
    "src": "/tokens/So11111111111111111111111111111111111111112.png",
    "name": "Solana",
    "sourceUrl": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "943c48e760ec717f55363835067d501ff4bd6825a29732a18955e141ba536602",
    "bytes": 32126,
    "mint": "So11111111111111111111111111111111111111112",
    "symbol": "SOL"
  },
  "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg": {
    "src": "/tokens/Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg.svg",
    "name": "Amazon",
    "sourceUrl": "https://cdn.prod.website-files.com/655f3efc4be468487052e35a/68497d354d7140b01657a793_Ticker%3DAMZN%2C%20Company%20Name%3DAmazon.com%20Inc.%2C%20size%3D256x256.svg",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "4cfda8673efe3a280343c1f044b7d0275ca9f4a590b29c2b0975684966a20aba",
    "bytes": 2370,
    "mint": "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    "symbol": "AMZNx"
  },
  "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN": {
    "src": "/tokens/XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN.svg",
    "name": "Alphabet (Google)",
    "sourceUrl": "https://cdn.prod.website-files.com/655f3efc4be468487052e35a/684aae04a3d8452e0ae4bad8_Ticker%3DGOOG%2C%20Company%20Name%3DAlphabet%20Inc.%2C%20size%3D256x256.svg",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "271bca748a5afd9666be36827a3f302370663bdb0b795d0e0bc5e8c843e6bb83",
    "bytes": 1559,
    "mint": "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    "symbol": "GOOGLx"
  },
  "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu": {
    "src": "/tokens/Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu.svg",
    "name": "Meta Platforms",
    "sourceUrl": "https://cdn.prod.website-files.com/655f3efc4be468487052e35a/68497dee3db1bae97b91ac05_Ticker%3DMETA%2C%20Company%20Name%3DMeta%20Platforms%20Inc.%2C%20size%3D256x256.svg",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "bad97d2f7309c5cca1348fb645dfb165f6f58bf07a38535738e2c77aabb16f65",
    "bytes": 2578,
    "mint": "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    "symbol": "METAx"
  },
  "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh": {
    "src": "/tokens/Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh.svg",
    "name": "NVIDIA",
    "sourceUrl": "https://cdn.prod.website-files.com/655f3efc4be468487052e35a/684961bfb45e3c4d777b9997_Ticker%3DNVDA%2C%20Company%20Name%3DNVIDIA%20Corp%2C%20size%3D256x256.svg",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "64499f560d10e272b3b6460d63dda22c7d1332d50e45aa99abfab72e60d5dc94",
    "bytes": 1827,
    "mint": "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    "symbol": "NVDAx"
  },
  "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4": {
    "src": "/tokens/XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4.svg",
    "name": "Palantir",
    "sourceUrl": "https://cdn.prod.website-files.com/655f3efc4be468487052e35a/684c0c4c0e5466272c52958b_Ticker%3DPLTR%2C%20Company%20Name%3DSP500%2C%20size%3D256x256.svg",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "52aee34140ef8e63ad640a4e5eee5cab6b84b533112acc4a7824abc20fa81498",
    "bytes": 1588,
    "mint": "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4",
    "symbol": "PLTRx"
  },
  "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX": {
    "src": "/tokens/XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX.svg",
    "name": "Microsoft",
    "sourceUrl": "https://cdn.prod.website-files.com/655f3efc4be468487052e35a/68497bdc918924ea97fd8211_Ticker%3DMSFT%2C%20Company%20Name%3DMicrosoft%20Inc.%2C%20size%3D256x256.svg",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "c42b914b62505fa31b2872e3c5d99ff2e4f354eebebf8586a00a328684763140",
    "bytes": 1293,
    "mint": "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
    "symbol": "MSFTx"
  },
  "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re": {
    "src": "/tokens/Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re.svg",
    "name": "SPDR Gold Trust",
    "sourceUrl": "https://cdn.prod.website-files.com/655f3efc4be468487052e35a/685123a7747987b071b10d47_Ticker%3DGLD%2C%20Company%20Name%3DGold%2C%20size%3D256x256.svg",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "a3fa6697fed7e5b62f6658a80c6baf87ee5197df513386c390ef6219bb00df75",
    "bytes": 2150,
    "mint": "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    "symbol": "GLDx"
  },
  "fDxs5y12E7x7jBwCKBXGqt71uJmCWsAQ3Srkte6ondo": {
    "src": "/tokens/fDxs5y12E7x7jBwCKBXGqt71uJmCWsAQ3Srkte6ondo.png",
    "name": "Meta Platforms",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/metaon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "eb2e6043b4edb2386dde1773fabe6fda85f194407308ea53280d736dcf3c2ffa",
    "bytes": 5267,
    "mint": "fDxs5y12E7x7jBwCKBXGqt71uJmCWsAQ3Srkte6ondo",
    "symbol": "METAon"
  },
  "g4KnPrxPLeeKkwvDmZFMtYQPM64eHeShbD55vK6ondo": {
    "src": "/tokens/g4KnPrxPLeeKkwvDmZFMtYQPM64eHeShbD55vK6ondo.png",
    "name": "Netflix",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/nflxon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "3b2c5ee9bcaf58f6a45fac660b6bded5d57300e71e4e0511ab404d7342071eb1",
    "bytes": 4280,
    "mint": "g4KnPrxPLeeKkwvDmZFMtYQPM64eHeShbD55vK6ondo",
    "symbol": "NFLXon"
  },
  "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL": {
    "src": "/tokens/jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL.webp",
    "name": "Jito",
    "sourceUrl": "https://metadata.jito.network/token/jto/image",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "5606ba3703e034480d532481490107ee8c00900c52dd96bc7099ce2c2e7305f8",
    "bytes": 6300,
    "mint": "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    "symbol": "JTO"
  },
  "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v": {
    "src": "/tokens/jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v.png",
    "name": "Jupiter Staked SOL",
    "sourceUrl": "https://static.jup.ag/jupSOL/icon.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "b7acd8e9094739758bdabb0885a114bc610f4ad5f41f4fce4c9d163315e2b04a",
    "bytes": 40867,
    "mint": "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
    "symbol": "JupSOL"
  },
  "keybg184d4vyXeQdFqs4o99YsMg7xBthxTJ6Ky3ondo": {
    "src": "/tokens/keybg184d4vyXeQdFqs4o99YsMg7xBthxTJ6Ky3ondo.png",
    "name": "Taiwan Semiconductor Manufacturing",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/tsmon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "799de7a30506751c8c098ec6aca37ae3f71fe8dbe7f76a61a20608c3fb874732",
    "bytes": 4759,
    "mint": "keybg184d4vyXeQdFqs4o99YsMg7xBthxTJ6Ky3ondo",
    "symbol": "TSMon"
  },
  "kxEW4oJL75K37VeXaZF1ynbHQATQwhECQKN1374ondo": {
    "src": "/tokens/kxEW4oJL75K37VeXaZF1ynbHQATQwhECQKN1374ondo.png",
    "name": "Visa",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/von_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "7f841b410d6285493ad83e0f394122ad1dd07e2679d3f02386afc9a9245a105c",
    "bytes": 4980,
    "mint": "kxEW4oJL75K37VeXaZF1ynbHQATQwhECQKN1374ondo",
    "symbol": "Von"
  },
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": {
    "src": "/tokens/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So.png",
    "name": "Marinade Staked SOL",
    "sourceUrl": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "ba4d12c86b66832be40c0954adc4b20e87fcff49e264e111d335990fbab2eacf",
    "bytes": 10769,
    "mint": "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    "symbol": "mSOL"
  },
  "tiitb2Z1HtpB2DpVr6V7tdCFS3jmTinLeuGj9EVondo": {
    "src": "/tokens/tiitb2Z1HtpB2DpVr6V7tdCFS3jmTinLeuGj9EVondo.png",
    "name": "VanEck Rare Earth and Strategic Metals ETF",
    "sourceUrl": "https://cdn.ondo.finance/tokens/logos/remxon_160x160.png",
    "sourcePage": "https://backend.cesto.co/tokens",
    "retrievedAt": "2026-10-11T14:29:21.025062Z",
    "sha256": "b7ab56f71716abebf7bc2f0a28cea39e8ec167ec960d1ce4b4e6f80a500f397f",
    "bytes": 4850,
    "mint": "tiitb2Z1HtpB2DpVr6V7tdCFS3jmTinLeuGj9EVondo",
    "symbol": "REMXon"
  }
});
export const partnerAsset = id => typeof id === "string" && Object.hasOwn(PARTNER_ASSETS, id) ? PARTNER_ASSETS[id] : null;
export const tokenAsset = mint => typeof mint === "string" && Object.hasOwn(TOKEN_ASSETS, mint) ? TOKEN_ASSETS[mint] : null;
