import Testing
@testable import OpenClaw

@Suite(.serialized) struct TalkModeManagerTests {
    @Test @MainActor func resolveVoiceAliasAcceptsLikelyVoiceID() {
        let manager = TalkModeManager(allowSimulatorCapture: true)
        let voiceID = "pMsXgVXv3BLzUgSXRplE"

        #expect(manager.resolveVoiceAlias(voiceID) == voiceID)
        #expect(manager.resolveVoiceAlias("  \(voiceID)  ") == voiceID)
        #expect(manager.resolveVoiceAlias("not a valid voice id!") == nil)
    }

    @Test @MainActor func incrementalIngestReturnsFinalRemainderWithoutBoundary() {
        let manager = TalkModeManager(allowSimulatorCapture: true)
        manager._test_incrementalReset()

        let partial = manager._test_incrementalIngest("hello there", isFinal: false)
        #expect(partial.isEmpty)

        let final = manager._test_incrementalIngest("hello there", isFinal: true)
        #expect(final == ["hello there"])
    }

    @Test @MainActor func incrementalIngestSplitsAtBoundary() {
        let manager = TalkModeManager(allowSimulatorCapture: true)
        manager._test_incrementalReset()

        let chunk1 = manager._test_incrementalIngest("Hello", isFinal: false)
        #expect(chunk1.isEmpty)

        let chunk2 = manager._test_incrementalIngest("Hello there.", isFinal: false)
        #expect(chunk2 == ["Hello there."])
    }
}
