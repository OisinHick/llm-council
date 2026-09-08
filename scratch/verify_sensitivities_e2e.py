import json
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

def test_api_agent_stream_sensitivity():
    print("=== Testing /api/agent/stream with Deliberation Sensitivity ===")
    
    # 1. Test with Low Sensitivity
    mock_chairman_resp = AsyncMock(side_effect=[
        {"content": '```json\n{"thought": "test action", "action": "complete_task", "params": {"summary": "done"}}\n```'}
    ])
    
    with patch("backend.main.stage1_collect_responses", AsyncMock(return_value=[{"model": "m1", "response": "resp"}])), \
         patch("backend.main.stage2_collect_rankings", AsyncMock(return_value=([{"model": "m1", "ranking": "1"}], {"Response A": "m1"}))), \
         patch("backend.main.stage3_synthesize_final", AsyncMock(return_value={"response": "synthesis"})), \
         patch("backend.agent.query_model", mock_chairman_resp), \
         patch("backend.agent.mcp_manager.get_available_tools", AsyncMock(return_value=[])):
        
        payload_low = {
            "request": "Test task with low sensitivity",
            "deliberation_sensitivity": "low",
            "sensitivity_config": {
                "level": "low",
                "auto_trigger_on_error": False,
                "review_before_completion": False,
                "max_consultations": 3
            },
            "max_steps": 5
        }
        
        with client.stream("POST", "/api/agent/stream", json=payload_low) as response:
            assert response.status_code == 200
            events = []
            for line in response.iter_lines():
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    events.append(data.get("type"))
            
            print("Low sensitivity received events:", events)
            assert "council_deliberation_start" in events
            assert "stage3_complete" in events
            assert "agent_complete" in events
            print("✓ Low sensitivity request processed cleanly.")

    # 2. Test with Extreme Sensitivity and pre-completion review
    mock_review_data = {
        "consensus_recommendation": "Council says approved!",
        "aggregate_rankings": []
    }
    mock_chairman_resp_extreme = AsyncMock(side_effect=[
        {"content": '```json\n{"thought": "request completion", "action": "complete_task", "params": {"summary": "first try"}}\n```'},
        {"content": '```json\n{"thought": "finalize completion", "action": "complete_task", "params": {"summary": "finalized"}}\n```'}
    ])

    with patch("backend.main.stage1_collect_responses", AsyncMock(return_value=[{"model": "m1", "response": "resp"}])), \
         patch("backend.main.stage2_collect_rankings", AsyncMock(return_value=([{"model": "m1", "ranking": "1"}], {"Response A": "m1"}))), \
         patch("backend.main.stage3_synthesize_final", AsyncMock(return_value={"response": "synthesis"})), \
         patch("backend.agent.query_model", mock_chairman_resp_extreme), \
         patch("backend.agent.run_sub_council", AsyncMock(return_value=mock_review_data)), \
         patch("backend.agent.mcp_manager.get_available_tools", AsyncMock(return_value=[])):

        payload_extreme = {
            "request": "Test task with extreme sensitivity",
            "deliberation_sensitivity": "extreme",
            "sensitivity_config": {
                "level": "extreme",
                "auto_trigger_on_error": True,
                "review_before_completion": True,
                "max_consultations": 5
            },
            "max_steps": 5
        }

        with client.stream("POST", "/api/agent/stream", json=payload_extreme) as response:
            assert response.status_code == 200
            events = []
            for line in response.iter_lines():
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    events.append(data.get("type"))

            print("Extreme sensitivity received events:", events)
            assert "consult_council_start" in events
            assert "consult_council_complete" in events
            assert "agent_complete" in events
            print("✓ Extreme sensitivity triggered pre-completion Council review as expected!")

    print("\nAll deliberation sensitivity verification checks PASSED!")

if __name__ == "__main__":
    test_api_agent_stream_sensitivity()
