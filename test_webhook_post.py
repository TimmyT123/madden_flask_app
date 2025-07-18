import requests
import json

# The URL to your local Flask app
url = "http://127.0.0.1:5000/webhook/passing"

# Example payload simulating passing stats
fake_data = {
    "playerReceivingStatInfoList": [
        {
            "fullName": "G. Pickens",
            "recCatches": 6,
            "recYds": 89,
            "recTDs": 2
        },
        {
            "fullName": "P. Freiermuth",
            "recCatches": 5,
            "recYds": 43,
            "recTDs": 0
        }
    ]
}

headers = {
    "Content-Type": "application/json"
}

response = requests.post(url, data=json.dumps(fake_data), headers=headers)

print("Status Code:", response.status_code)
print("Response Text:", response.text)
