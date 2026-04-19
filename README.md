# 🌍 Country Guess

A tiny browser game: a country's flag is shown, you type its name (English or Swedish). You get 3 mistakes before it's game over.

Play: https://tgwizard.github.io/country-guess/

## Run locally

```sh
python3 -m http.server 8765
# then open http://localhost:8765/
```

Pure static site — no build step. Uses D3 + [world-atlas](https://github.com/topojson/world-atlas) over a CDN.
