from app.integrations.twelvelabs import create_response as twelvelabs_create_response


def create_twelvelabs_response(payload):
    return twelvelabs_create_response(payload)
