"""Keep diarization identity separate from channel/echo/timing evidence."""
def speaker_for(source,start,end,turns,evidence):
    scores={}
    for turn in turns:
        overlap=max(0,min(end,turn['end'])-max(start,turn['start']))
        if overlap:scores[str(turn['speaker'])]=scores.get(str(turn['speaker']),0)+overlap
    candidates=sorted(scores,key=lambda k:(-scores[k],k));prefix='remote-' if source=='computer' else 'microphone-'
    speaker=prefix+candidates[0] if candidates else prefix+'unknown'
    # Echo/reference ambiguity concerns the captured microphone, not the remote
    # cluster on the original computer channel. Simultaneity alone is no veto.
    acoustic_uncertain=source=='microphone' and evidence.get('reference',{}).get('state') in ['reference-dominant','reference-component']
    uncertain=len(candidates)!=1 or acoustic_uncertain
    return speaker,dict(version=2,uncertain=bool(uncertain),evidence='channel-diarization' if candidates else 'no-diarization-candidate',sourceScoped=True,knownPerson=False,acousticUncertainty=bool(acoustic_uncertain)),[prefix+c for c in candidates]
