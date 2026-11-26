"""State-only reproduction of the inspected UzSLR web backend capture gate."""


class UzslrWebGate:
    def __init__(self, buffer_size=32, missing_tolerance=5):
        self.buffer_size = buffer_size
        self.missing_tolerance = missing_tolerance
        self.active = False
        self.missing = 0
        self.frames = []

    def push(self, frame, both_hands):
        if both_hands:
            self.missing = 0
            if not self.active:
                self.frames = []
                self.active = True
        elif self.active:
            self.missing += 1
            if self.missing > self.missing_tolerance:
                self.active = False
                self.frames = []
        if self.active and len(self.frames) < self.buffer_size:
            self.frames.append(frame)
        if self.active and len(self.frames) == self.buffer_size:
            ready = self.frames
            self.frames = []
            return ready
        return None
