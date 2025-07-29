from flask import Flask, Response
import cv2

app = Flask(__name__)

# Initialize camera
camera = cv2.VideoCapture(0)  # 0 is the default webcam
if not camera.isOpened():
    print("Error: Camera could not be opened.")

def generate_frames():
    while True:
        success, frame = camera.read()
        if not success:
            print("Error: Could not read frame from camera.")
            break
        else:
            ret, buffer = cv2.imencode('.jpg', frame)
            frame = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
