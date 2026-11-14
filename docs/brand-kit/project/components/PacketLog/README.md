# PacketLog

Every USIS packet the input layer received, newest last, modelled on the Network panel in browser DevTools. Columns: time, device, seq, channels and size; click a row (or use the arrow keys) to see the packet as JSON on the right. Rows with a seq gap get a `warn` edge and the detail says how many packets were missed; packets that failed validation are drawn in `error` and the detail leads with the reason. JSON keys are `text-secondary`, and x/y/z components carry the axis colors. This view and the device list are the only places the packet `source` is visible.
