# Review suggestions for paused recordings

The normal matcher still decides first. When it rejects a movement as distant or
ambiguous, two additional windows remove only quiet edges while preserving all
internal frames. A label is offered for manual review only when both windows
accept the same label. The result stays unrecognized until the
person selects a suggestion, then confirms the text in the normal flow.

On 46 previously inspected saved word replays, unchanged recordings remained
40 correct, one wrong and five rejected. With an artificial half-second hold at
each end, 36 were accepted, one wrong, nine rejected, and three of the rejected
examples received the correct review suggestion. With a one-second hold at each
end, 32 were accepted, one wrong, 13 rejected, and five of the rejected examples
received the correct suggestion. No incorrect new suggestion occurred in those
checks, and three available unknown recordings produced no such suggestion.

The extra holds repeated existing frames and do not reproduce natural waiting,
camera latency or differences between signers. These are development checks,
not a real-world accuracy estimate. Some signs include meaningful holds, so the
complete recording is always evaluated first and is never replaced by a crop.
