# StatusBar

A 22px bar along the bottom of the window: where input comes from, frame time, the jitter delay and the input latency against the 50 ms budget. Over budget, the latency reads in `warn` with the actual number. In Live mode the whole bar fills with `live`, as VS Code's status bar changes color while debugging.
